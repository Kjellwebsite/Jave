import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { evidence, members, verificationEvidence, verifications } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { actorUserId } from '../permissions/actor';
import { OPEN_STATUSES } from './rules';
import type {
  LoadedVerification,
  VerificationOutcome,
  VerificationRecord,
  VerificationStatus,
} from './types';

function selectLoaded(ctx: Pick<ServiceContext, 'db'>, id: string) {
  return ctx.db
    .select({ verification: verifications, subjectUserId: members.userId })
    .from(verifications)
    .innerJoin(members, eq(members.id, verifications.subjectMemberId))
    .where(eq(verifications.id, id));
}

export async function findVerification(
  ctx: Pick<ServiceContext, 'db'>,
  id: string,
): Promise<LoadedVerification | null> {
  const [row] = await selectLoaded(ctx, id);
  return row ? { ...row.verification, subjectUserId: row.subjectUserId } : null;
}

export async function loadVerification(
  ctx: Pick<ServiceContext, 'db'>,
  id: string,
): Promise<LoadedVerification> {
  const row = await findVerification(ctx, id);
  if (!row) throw new NotFoundError('Verification');
  return row;
}

/** Load and row-lock a verification inside a transaction (serializes concurrent decisions). */
export async function lockVerification(
  tx: Pick<ServiceContext, 'db'>,
  id: string,
): Promise<LoadedVerification> {
  const [row] = await selectLoaded(tx, id).for('update', { of: verifications });
  if (!row) throw new NotFoundError('Verification');
  return { ...row.verification, subjectUserId: row.subjectUserId };
}

/**
 * Conditional update: only applies while the verification is still in one of
 * `from`. A lost race surfaces as a ConflictError instead of a silent overwrite.
 */
export async function updateVerificationFrom(
  tx: Pick<ServiceContext, 'db'>,
  id: string,
  from: readonly VerificationStatus[],
  patch: Partial<typeof verifications.$inferInsert>,
): Promise<VerificationRecord> {
  const [row] = await tx.db
    .update(verifications)
    .set(patch)
    .where(and(eq(verifications.id, id), inArray(verifications.status, [...from])))
    .returning();
  if (!row) throw new ConflictError('This verification changed in the meantime. Reload and retry.');
  return row;
}

export async function linkEvidence(
  tx: Pick<ServiceContext, 'db'>,
  verificationId: string,
  evidenceIds: readonly string[],
): Promise<void> {
  if (evidenceIds.length === 0) return;
  await tx.db
    .insert(verificationEvidence)
    .values(evidenceIds.map((evidenceId) => ({ verificationId, evidenceId })))
    .onConflictDoNothing();
}

function linkedEvidenceIds(tx: Pick<ServiceContext, 'db'>, verificationId: string) {
  return tx.db
    .select({ id: verificationEvidence.evidenceId })
    .from(verificationEvidence)
    .where(eq(verificationEvidence.verificationId, verificationId));
}

/**
 * Mark the still-unreviewed evidence linked to a verification as accepted,
 * stamped with the decision time so a revocation can find exactly these rows.
 */
export async function acceptLinkedEvidence(
  tx: ServiceContext,
  verification: LoadedVerification,
  decidedAt: Date,
): Promise<number> {
  const rows = await tx.db
    .update(evidence)
    .set({ status: 'accepted', reviewedAt: decidedAt, reviewedByUserId: actorUserId(tx.actor) })
    .where(
      and(
        inArray(evidence.id, linkedEvidenceIds(tx, verification.id)),
        eq(evidence.memberId, verification.subjectMemberId),
        eq(evidence.status, 'submitted'),
        isNull(evidence.deletedAt),
      ),
    )
    .returning({ id: evidence.id });
  return rows.length;
}

/**
 * Revocation: evidence this verification's approval accepted (same decision
 * time and reviewer, still accepted) returns to submitted, i.e. unreviewed.
 * Evidence reviewed by anything else is left alone.
 */
export async function restoreLinkedEvidence(
  tx: ServiceContext,
  verification: LoadedVerification,
  excludeEvidenceId: string | null,
): Promise<number> {
  if (!verification.decidedAt) return 0;
  const conditions = [
    inArray(evidence.id, linkedEvidenceIds(tx, verification.id)),
    eq(evidence.memberId, verification.subjectMemberId),
    eq(evidence.status, 'accepted'),
    eq(evidence.reviewedAt, verification.decidedAt),
    sql`${evidence.reviewedByUserId} is not distinct from ${verification.verifierUserId}`,
  ];
  if (excludeEvidenceId) conditions.push(ne(evidence.id, excludeEvidenceId));
  const rows = await tx.db
    .update(evidence)
    .set({ status: 'submitted', reviewedAt: null, reviewedByUserId: null })
    .where(and(...conditions))
    .returning({ id: evidence.id });
  return rows.length;
}

/** Existing open verification for a target key, if any. */
export async function findOpenByTargetKey(
  ctx: Pick<ServiceContext, 'db'>,
  targetKey: string,
): Promise<{ id: string; number: number } | null> {
  const [row] = await ctx.db
    .select({ id: verifications.id, number: verifications.number })
    .from(verifications)
    .where(
      and(eq(verifications.targetKey, targetKey), inArray(verifications.status, OPEN_STATUSES)),
    )
    .limit(1);
  return row ?? null;
}

export async function findApprovedByTargetKey(
  ctx: Pick<ServiceContext, 'db'>,
  targetKey: string,
): Promise<{ id: string; number: number } | null> {
  const [row] = await ctx.db
    .select({ id: verifications.id, number: verifications.number })
    .from(verifications)
    .where(and(eq(verifications.targetKey, targetKey), eq(verifications.status, 'approved')))
    .limit(1);
  return row ?? null;
}

const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role'), granted: z.boolean(), previousRole: z.string().nullable() }),
  z.object({
    kind: z.literal('rank'),
    facetKey: z.string(),
    previousRank: z.string().nullable(),
    grantedRank: z.string(),
    rankHistoryId: z.string().nullable(),
  }),
  z.object({ kind: z.literal('evidence'), evidenceId: z.string() }),
  z.object({ kind: z.literal('contribution'), contributionId: z.string() }),
  z.object({ kind: z.literal('achievement'), memberAchievementId: z.string() }),
]);

/** Validate a stored outcome before acting on it (jsonb is not trusted blindly). */
export function parseOutcome(value: unknown): VerificationOutcome {
  const result = outcomeSchema.safeParse(value);
  if (!result.success)
    throw new InvalidStateError('This verification has no valid recorded outcome to reverse.');
  return result.data;
}

/** Narrow an outcome to the kind a strategy produced. */
export function expectOutcome<K extends VerificationOutcome['kind']>(
  outcome: VerificationOutcome,
  kind: K,
): Extract<VerificationOutcome, { kind: K }> {
  if (outcome.kind !== kind)
    throw new InvalidStateError('This verification has no valid recorded outcome to reverse.');
  return outcome as Extract<VerificationOutcome, { kind: K }>;
}
