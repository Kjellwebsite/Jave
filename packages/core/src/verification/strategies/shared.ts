import { and, eq } from 'drizzle-orm';
import { evidence } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { InvalidStateError, ValidationError } from '../../kernel/errors';
import { actorUserId } from '../../permissions/actor';
import { linkEvidence } from '../repository';
import type { VerificationTarget } from '../schemas';
import type { LoadedVerification, VerificationType } from '../types';

const MAX_EVIDENCE_TITLE = 200;

/** Narrow a target to the strategy's own type. */
export function expectTarget<T extends VerificationType>(
  target: VerificationTarget,
  type: T,
): Extract<VerificationTarget, { type: T }> {
  if (target.type !== type)
    throw new ValidationError('The target does not match the verification type.');
  return target as Extract<VerificationTarget, { type: T }>;
}

/** The stored target id; a missing one means the row was written incorrectly. */
export function requireTargetId(verification: LoadedVerification): string {
  if (!verification.targetId)
    throw new InvalidStateError('This verification has no target on record.');
  return verification.targetId;
}

/** When the verification was decided; revocations match approval rows against it. */
export function requireDecidedAt(verification: LoadedVerification): Date {
  if (!verification.decidedAt)
    throw new InvalidStateError('This verification has no decision on record.');
  return verification.decidedAt;
}

export interface OutcomeEvidenceInput {
  kind: 'project' | 'trial';
  title: string;
  description: string;
  sourceType: string;
  sourceId: string;
  facetKey: string | null;
  decidedAt: Date;
}

/**
 * Record the evidence an approval produces (e.g. "project member", "trial
 * result") as accepted evidence owned by the subject, and link it to the
 * verification.
 */
export async function recordOutcomeEvidence(
  tx: ServiceContext,
  verification: LoadedVerification,
  input: OutcomeEvidenceInput,
): Promise<string> {
  const verifierUserId = actorUserId(tx.actor);
  const [row] = await tx.db
    .insert(evidence)
    .values({
      memberId: verification.subjectMemberId,
      kind: input.kind,
      title: input.title.slice(0, MAX_EVIDENCE_TITLE),
      description: input.description,
      facetKey: input.facetKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: 'accepted',
      reviewedAt: input.decidedAt,
      reviewedByUserId: verifierUserId,
      createdByUserId: verifierUserId,
    })
    .returning({ id: evidence.id });
  const evidenceId = row!.id;
  await linkEvidence(tx, verification.id, [evidenceId]);
  return evidenceId;
}

/** Revocation: the evidence an approval recorded no longer stands. */
export async function withdrawOutcomeEvidence(
  tx: ServiceContext,
  evidenceId: string,
): Promise<boolean> {
  const rows = await tx.db
    .update(evidence)
    .set({
      status: 'rejected',
      reviewedAt: tx.clock.now(),
      reviewedByUserId: actorUserId(tx.actor),
    })
    .where(and(eq(evidence.id, evidenceId), eq(evidence.status, 'accepted')))
    .returning({ id: evidence.id });
  return rows.length > 0;
}
