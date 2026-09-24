import type { z } from 'zod';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { getMemberById } from '../identity/users.service';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { enqueueQueueCard } from './discord-jobs';
import {
  assertAssignee,
  assertGoodStanding,
  assertNotSubject,
  assertReviewer,
  authorizeStrategy,
} from './guards';
import { notifySubject } from './notices';
import { getVerification, type VerificationDetail } from './query.service';
import {
  acceptLinkedEvidence,
  loadVerification,
  lockVerification,
  parseOutcome,
  restoreLinkedEvidence,
  updateVerificationFrom,
} from './repository';
import { assertTransition, OPEN_STATUSES, verificationReference } from './rules';
import { decideVerificationSchema, revokeVerificationSchema } from './schemas';
import { strategyFor } from './strategies';
import type { ApprovalResult, LoadedVerification } from './types';

function eventPayload(v: LoadedVerification, extra: Record<string, unknown> = {}) {
  return {
    verificationId: v.id,
    reference: verificationReference(v.number),
    type: v.type,
    targetType: v.targetType,
    targetId: v.targetId,
    facetKey: v.facetKey,
    ...extra,
  };
}

/**
 * Approve or reject an open verification. Requires canVerifyMembers (plus the
 * type's own capabilities, e.g. canModifyRanks for skill), a note, and a
 * decider who is neither the subject nor the staff member who opened the
 * request on the subject's behalf. When assigned, only the assignee decides.
 */
export async function decideVerification(
  ctx: ServiceContext,
  input: z.input<typeof decideVerificationSchema>,
): Promise<VerificationDetail> {
  const data = parseInput(decideVerificationSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id: data.verificationId });
  const verification = await loadVerification(ctx, data.verificationId);
  const strategy = strategyFor(verification.type);
  await assertReviewer(ctx, verification, strategy, data.decision);
  if (
    data.grantedRank !== undefined &&
    (verification.type !== 'skill' || data.decision !== 'approve')
  )
    throw new ValidationError('A granted rank applies only when approving a skill verification.');
  const status = data.decision === 'approve' ? 'approved' : 'rejected';
  const now = ctx.clock.now();
  assertTransition(verification, status, now);
  if (status === 'approved')
    assertGoodStanding(await getMemberById(ctx, verification.subjectMemberId));

  await withTransaction(ctx, async (tx) => {
    const current = await lockVerification(tx, verification.id);
    assertTransition(current, status, now);
    assertAssignee(tx, current);
    const reference = verificationReference(current.number);
    let approval: ApprovalResult | null = null;
    if (status === 'approved') {
      approval = await strategy.approve(tx, current, {
        grantedRank: data.grantedRank ?? null,
        note: data.note,
        reference,
        decidedAt: now,
      });
      await acceptLinkedEvidence(tx, current, now);
    }
    const updated = await updateVerificationFrom(tx, current.id, OPEN_STATUSES, {
      status,
      verifierUserId: actorUserId(tx.actor),
      decisionNote: data.note,
      decidedAt: now,
      grantedRank: approval?.grantedRank ?? null,
      outcome: approval?.outcome ?? null,
      reviewStartedAt: current.reviewStartedAt ?? now,
    });
    await recordAudit(tx, {
      action: `verification.${status}`,
      targetType: 'verification',
      targetId: current.id,
      context: {
        reference,
        type: current.type,
        subjectMemberId: current.subjectMemberId,
        note: data.note,
        grantedRank: approval?.grantedRank ?? null,
        outcome: approval?.outcome ?? null,
      },
    });
    await publishEvent(tx, {
      type: status === 'approved' ? 'verification.approved' : 'verification.rejected',
      aggregateType: 'verification',
      aggregateId: current.id,
      subjectMemberId: current.subjectMemberId,
      payload: eventPayload(current, { grantedRank: approval?.grantedRank ?? null }),
    });
    await notifySubject(
      tx,
      current,
      status === 'approved'
        ? { kind: 'approved', grantedRank: approval?.grantedRank ?? null }
        : { kind: 'rejected', note: data.note },
      { dmAlreadySent: approval?.subjectNotified ?? false },
    );
    await enqueueQueueCard(tx, updated);
  });
  return getVerification(ctx, verification.id);
}

/**
 * Revoke an approved verification and reverse exactly what its approval
 * changed (see each strategy). Requires canVerifyMembers plus the type's own
 * capabilities and a reason; nobody revokes a verification about themselves.
 */
export async function revokeVerification(
  ctx: ServiceContext,
  input: z.input<typeof revokeVerificationSchema>,
): Promise<VerificationDetail> {
  const data = parseInput(revokeVerificationSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id: data.verificationId });
  const verification = await loadVerification(ctx, data.verificationId);
  const strategy = strategyFor(verification.type);
  await assertNotSubject(ctx, verification, 'revoke');
  await authorizeStrategy(ctx, verification, strategy);
  const now = ctx.clock.now();
  assertTransition(verification, 'revoked', now);

  await withTransaction(ctx, async (tx) => {
    const current = await lockVerification(tx, verification.id);
    assertTransition(current, 'revoked', now);
    if (current.outcome === null)
      throw new InvalidStateError('This verification has no recorded outcome to reverse.');
    const reference = verificationReference(current.number);
    const outcome = parseOutcome(current.outcome);
    const reversal = await strategy.revoke(tx, current, outcome, {
      reason: data.reason,
      reference,
    });
    const evidenceReview = await restoreLinkedEvidence(
      tx,
      current,
      outcome.kind === 'evidence' ? outcome.evidenceId : null,
    );
    const updated = await updateVerificationFrom(tx, current.id, ['approved'], {
      status: 'revoked',
      revokedAt: now,
      revokedByUserId: actorUserId(tx.actor),
      revokeReason: data.reason,
    });
    await recordAudit(tx, {
      action: 'verification.revoked',
      targetType: 'verification',
      targetId: current.id,
      context: {
        reference,
        type: current.type,
        subjectMemberId: current.subjectMemberId,
        reason: data.reason,
        reverted: reversal.reverted,
        detail: reversal.detail,
        evidenceRestored: evidenceReview.restored,
        evidenceRetained: evidenceReview.retained,
      },
    });
    await publishEvent(tx, {
      type: 'verification.revoked',
      aggregateType: 'verification',
      aggregateId: current.id,
      subjectMemberId: current.subjectMemberId,
      payload: eventPayload(current, { reverted: reversal.reverted }),
    });
    await notifySubject(
      tx,
      current,
      { kind: 'revoked', reason: data.reason },
      { dmAlreadySent: reversal.subjectNotified },
    );
    await enqueueQueueCard(tx, updated);
  });
  return getVerification(ctx, verification.id);
}
