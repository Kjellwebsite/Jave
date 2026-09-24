import type { z } from 'zod';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { getMemberById, resolveUserActor } from '../identity/users.service';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { enqueueQueueCard } from './discord-jobs';
import {
  assertAssignee,
  assertNotStaffRequester,
  assertNotSubject,
  assertReviewer,
} from './guards';
import { notifyAssignee } from './notices';
import { getVerification, type VerificationDetail } from './query.service';
import { loadVerification, lockVerification, updateVerificationFrom } from './repository';
import {
  assertOpen,
  assertTransition,
  OPEN_STATUSES,
  verificationReference,
  verifierConflict,
} from './rules';
import { assignVerifierSchema, verificationIdSchema } from './schemas';
import { strategyFor } from './strategies';
import type { LoadedVerification } from './types';

/**
 * Check a prospective verifier: not the subject, not the staff member who
 * opened the request for someone else, in good standing, and holding every
 * capability the decision needs.
 */
async function assertEligibleVerifier(
  ctx: ServiceContext,
  verification: LoadedVerification,
  verifierMemberId: string,
): Promise<string> {
  const member = await getMemberById(ctx, verifierMemberId);
  const verifier = await resolveUserActor(ctx, member.userId);
  const conflict = verifierConflict({
    verifierUserId: verifier.userId,
    subjectUserId: verification.subjectUserId,
    requestedByUserId: verification.requestedByUserId,
  });
  if (conflict === 'subject')
    throw new ValidationError('The subject cannot verify their own request.');
  if (conflict === 'requester')
    throw new ValidationError('Whoever opened a request for someone else cannot also verify it.');
  const needed = [
    'canVerifyMembers' as const,
    ...strategyFor(verification.type).deciderCapabilities,
  ];
  if (!needed.every((capability) => verifier.capabilities.has(capability)))
    throw new ValidationError('That member cannot verify this request.');
  return verifier.userId;
}

/**
 * Assign (or with null, unassign) the verifier of an open verification.
 * Unassigning an in-review verification returns it to pending.
 */
export async function assignVerifier(
  ctx: ServiceContext,
  input: z.input<typeof assignVerifierSchema>,
): Promise<VerificationDetail> {
  const data = parseInput(assignVerifierSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id: data.verificationId });
  const verification = await loadVerification(ctx, data.verificationId);
  // The subject (or the staff member who opened it for them) must not pick their own verifier.
  await assertNotSubject(ctx, verification, 'assign_verifier');
  await assertNotStaffRequester(ctx, verification, 'assign_verifier');
  const now = ctx.clock.now();
  assertOpen(verification, now);
  const verifierUserId = data.verifierMemberId
    ? await assertEligibleVerifier(ctx, verification, data.verifierMemberId)
    : null;
  if (verification.assignedVerifierUserId === verifierUserId)
    return getVerification(ctx, verification.id);

  await withTransaction(ctx, async (tx) => {
    const current = await lockVerification(tx, verification.id);
    assertOpen(current, now);
    const unassignInReview = verifierUserId === null && current.status === 'in_review';
    if (unassignInReview) assertTransition(current, 'pending', now);
    const updated = await updateVerificationFrom(tx, current.id, OPEN_STATUSES, {
      assignedVerifierUserId: verifierUserId,
      ...(unassignInReview && { status: 'pending' as const, reviewStartedAt: null }),
    });
    await recordAudit(tx, {
      action: 'verification.assigned',
      targetType: 'verification',
      targetId: current.id,
      context: {
        reference: verificationReference(current.number),
        from: current.assignedVerifierUserId,
        to: verifierUserId,
      },
    });
    if (verifierUserId && verifierUserId !== actorUserId(tx.actor))
      await notifyAssignee(tx, current, verifierUserId);
    await enqueueQueueCard(tx, updated);
  });
  return getVerification(ctx, verification.id);
}

/**
 * Take a pending verification into review. The reviewer becomes the assigned
 * verifier. Idempotent for the reviewer who already holds it.
 */
export async function startReview(
  ctx: ServiceContext,
  input: z.input<typeof verificationIdSchema>,
): Promise<VerificationDetail> {
  const data = parseInput(verificationIdSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id: data.verificationId });
  const verification = await loadVerification(ctx, data.verificationId);
  const strategy = strategyFor(verification.type);
  await assertReviewer(ctx, verification, strategy, 'start_review');
  const me = actorUserId(ctx.actor);
  const now = ctx.clock.now();
  if (verification.status === 'in_review' && verification.assignedVerifierUserId === me) {
    assertOpen(verification, now);
    return getVerification(ctx, verification.id);
  }
  assertTransition(verification, 'in_review', now);

  await withTransaction(ctx, async (tx) => {
    const current = await lockVerification(tx, verification.id);
    assertTransition(current, 'in_review', now);
    assertAssignee(tx, current);
    const updated = await updateVerificationFrom(tx, current.id, ['pending'], {
      status: 'in_review',
      reviewStartedAt: now,
      assignedVerifierUserId: me ?? current.assignedVerifierUserId,
    });
    await recordAudit(tx, {
      action: 'verification.review_started',
      targetType: 'verification',
      targetId: current.id,
      context: { reference: verificationReference(current.number), type: current.type },
    });
    await enqueueQueueCard(tx, updated);
  });
  return getVerification(ctx, verification.id);
}
