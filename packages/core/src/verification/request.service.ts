import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { evidence, members, verifications } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, isUniqueViolation, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { getMemberById } from '../identity/users.service';
import { actorUserId } from '../permissions/actor';
import { authorize, isSelf, requireMember } from '../permissions/authorize';
import { enqueueQueueCard } from './discord-jobs';
import { assertGoodStanding } from './guards';
import { findApprovedByTargetKey, findOpenByTargetKey, linkEvidence } from './repository';
import {
  computeExpiry,
  MAX_OPEN_VERIFICATIONS_PER_MEMBER,
  OPEN_STATUSES,
  verificationReference,
} from './rules';
import {
  type NewEvidenceInput,
  type RequestVerificationInput,
  requestVerificationSchema,
} from './schemas';
import { getVerification, type VerificationDetail } from './query.service';
import { strategyFor } from './strategies';
import type { ResolvedTarget } from './types';

const OPEN_TARGET_CONSTRAINT = 'verifications_open_target_uq';

/** Self-service for your own verifications; staff with canVerifyMembers may open for others. */
async function resolveSubjectId(ctx: ServiceContext, requested: string | undefined) {
  if (requested === undefined) return requireMember(ctx).memberId;
  if (isSelf(ctx.actor, requested)) return requested;
  await authorize(ctx, 'canVerifyMembers', { type: 'member', id: requested });
  return requested;
}

/** Existing evidence must belong to the subject. Unknown and foreign ids fail identically. */
async function assertEvidenceOwned(
  ctx: ServiceContext,
  subjectMemberId: string,
  evidenceIds: readonly string[],
): Promise<void> {
  if (evidenceIds.length === 0) return;
  const rows = await ctx.db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        inArray(evidence.id, [...evidenceIds]),
        eq(evidence.memberId, subjectMemberId),
        isNull(evidence.deletedAt),
      ),
    );
  if (rows.length !== evidenceIds.length)
    throw new ValidationError('One or more evidence items were not found.', [
      { path: 'evidenceIds', message: 'not found' },
    ]);
}

async function assertNoDuplicate(
  ctx: ServiceContext,
  target: ResolvedTarget,
  singleApproval: boolean,
): Promise<void> {
  const open = await findOpenByTargetKey(ctx, target.targetKey);
  if (open)
    throw new ConflictError(
      `${verificationReference(open.number)} is already open for this target.`,
    );
  if (!singleApproval) return;
  const approved = await findApprovedByTargetKey(ctx, target.targetKey);
  if (approved)
    throw new ConflictError(`Already verified in ${verificationReference(approved.number)}.`);
}

/** Serialize requests per subject, then enforce the open-request cap for self-service. */
async function assertOpenCapacity(tx: ServiceContext, subjectMemberId: string): Promise<void> {
  await tx.db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, subjectMemberId))
    .for('update');
  const [open] = await tx.db
    .select({ value: count() })
    .from(verifications)
    .where(
      and(
        eq(verifications.subjectMemberId, subjectMemberId),
        inArray(verifications.status, OPEN_STATUSES),
      ),
    );
  if ((open?.value ?? 0) >= MAX_OPEN_VERIFICATIONS_PER_MEMBER)
    throw new ConflictError(
      `You have ${MAX_OPEN_VERIFICATIONS_PER_MEMBER} open verifications. Wait for decisions before requesting more.`,
    );
}

async function createEvidenceRows(
  tx: ServiceContext,
  subjectMemberId: string,
  verificationId: string,
  facetKey: string | null,
  items: readonly NewEvidenceInput[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const rows = await tx.db
    .insert(evidence)
    .values(
      items.map((item) => ({
        memberId: subjectMemberId,
        kind: item.url ? ('link' as const) : ('other' as const),
        title: item.title,
        url: item.url ?? null,
        description: item.description || null,
        facetKey,
        sourceType: 'verification',
        sourceId: verificationId,
        createdByUserId: actorUserId(tx.actor),
      })),
    )
    .returning({ id: evidence.id, kind: evidence.kind });
  for (const row of rows) {
    await publishEvent(tx, {
      type: 'evidence.submitted',
      aggregateType: 'evidence',
      aggregateId: row.id,
      subjectMemberId,
      payload: { kind: row.kind, facetKey, verificationId },
    });
  }
  return rows.map((row) => row.id);
}

/**
 * Open a verification: WHAT (claim + typed target), WHO (subject), WHEN
 * (requested now, expires after VERIFICATION_EXPIRY_DAYS), EVIDENCE (new rows
 * and/or existing evidence owned by the subject).
 */
export async function requestVerification(
  ctx: ServiceContext,
  input: RequestVerificationInput,
): Promise<VerificationDetail> {
  const data = parseInput(requestVerificationSchema, input);
  const subjectMemberId = await resolveSubjectId(ctx, data.subjectMemberId);
  const subject = await getMemberById(ctx, subjectMemberId);
  assertGoodStanding(subject);
  const strategy = strategyFor(data.target.type);
  const target = await strategy.resolveTarget(ctx, subject, data.target);
  await assertNoDuplicate(ctx, target, strategy.singleApproval);
  await assertEvidenceOwned(ctx, subject.id, data.evidenceIds);
  const selfRequest = isSelf(ctx.actor, subject.id);
  const now = ctx.clock.now();

  let verificationId: string;
  try {
    verificationId = await withTransaction(ctx, async (tx) => {
      if (selfRequest) await assertOpenCapacity(tx, subject.id);
      const [row] = await tx.db
        .insert(verifications)
        .values({
          type: strategy.type,
          subjectMemberId: subject.id,
          claim: data.claim ?? target.defaultClaim,
          targetType: target.targetType,
          targetId: target.targetId,
          targetKey: target.targetKey,
          targetLabel: target.targetLabel,
          facetKey: target.facetKey,
          requestedRank: target.requestedRank,
          status: 'pending',
          requestedByUserId: actorUserId(tx.actor),
          requestedAt: now,
          expiresAt: computeExpiry(now),
        })
        .returning();
      const created = row!;
      const newEvidenceIds = await createEvidenceRows(
        tx,
        subject.id,
        created.id,
        target.facetKey,
        data.evidence,
      );
      await linkEvidence(tx, created.id, [...newEvidenceIds, ...data.evidenceIds]);
      const reference = verificationReference(created.number);
      await recordAudit(tx, {
        action: 'verification.requested',
        targetType: 'verification',
        targetId: created.id,
        context: {
          reference,
          type: created.type,
          subjectMemberId: subject.id,
          targetKey: created.targetKey,
          openedFor: selfRequest ? 'self' : 'other',
          evidenceCount: newEvidenceIds.length + data.evidenceIds.length,
        },
      });
      await publishEvent(tx, {
        type: 'verification.requested',
        aggregateType: 'verification',
        aggregateId: created.id,
        subjectMemberId: subject.id,
        payload: {
          verificationId: created.id,
          reference,
          type: created.type,
          targetType: created.targetType,
          targetId: created.targetId,
          facetKey: created.facetKey,
          requestedRank: created.requestedRank,
          openedFor: selfRequest ? 'self' : 'other',
        },
      });
      await enqueueQueueCard(tx, created);
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, OPEN_TARGET_CONSTRAINT))
      throw new ConflictError('A verification is already open for this target.');
    throw error;
  }
  return getVerification(ctx, verificationId);
}
