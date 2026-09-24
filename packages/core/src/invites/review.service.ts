import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { referrals } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { canTransition } from './lifecycle';
import { inviterMemberId } from './lifecycle.service';
import type { ReferralRecord } from './scoring';

export const reviewReferralSchema = z.object({
  referralId: z.uuid(),
  decision: z.enum(['clear_flags', 'invalidate']),
  note: z.string().trim().min(3, 'Give a reason').max(1000),
});

/**
 * Staff verdict on a flagged referral. `clear_flags` marks a false positive
 * (the sweep then validates it normally and never re-flags it);
 * `invalidate` removes it from every count. Nobody reviews a referral they
 * are part of.
 */
export async function reviewReferral(
  ctx: ServiceContext,
  input: z.input<typeof reviewReferralSchema>,
): Promise<ReferralRecord> {
  const data = parseInput(reviewReferralSchema, input);
  await authorize(ctx, 'canManageCampaigns', { type: 'referral', id: data.referralId });
  const [referral] = await ctx.db.select().from(referrals).where(eq(referrals.id, data.referralId));
  if (!referral) throw new NotFoundError('Referral');
  const reviewer = actorUserId(ctx.actor);
  if (reviewer && (reviewer === referral.inviterUserId || reviewer === referral.inviteeUserId)) {
    await recordAudit(
      ctx,
      {
        action: 'referral.self_review_blocked',
        targetType: 'referral',
        targetId: referral.id,
        result: 'denied',
        context: { decision: data.decision },
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot review a referral you are part of.');
  }
  if (
    data.decision === 'clear_flags' &&
    !['joined', 'retained', 'valid'].includes(referral.status)
  ) {
    throw new InvalidStateError('Only active or valid referrals can be cleared.');
  }
  if (data.decision === 'invalidate' && !canTransition(referral.status, 'invalid')) {
    throw new InvalidStateError('This referral is already closed.');
  }
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const review = { reviewedByUserId: reviewer, reviewedAt: now, reviewNote: data.note };
    const changes =
      data.decision === 'clear_flags'
        ? { anomalyFlags: [], anomalyScore: 0, ...review }
        : { status: 'invalid' as const, statusReason: 'staff_invalidated', ...review };
    const [row] = await tx.db
      .update(referrals)
      .set({ ...changes, updatedAt: now })
      .where(and(eq(referrals.id, referral.id), eq(referrals.status, referral.status)))
      .returning();
    if (!row) throw new InvalidStateError('The referral changed meanwhile. Reload and retry.');
    await recordAudit(tx, {
      action: data.decision === 'clear_flags' ? 'referral.flags_cleared' : 'referral.invalidated',
      targetType: 'referral',
      targetId: referral.id,
      context: {
        previousStatus: referral.status,
        previousFlags: referral.anomalyFlags,
        previousScore: referral.anomalyScore,
        note: data.note,
      },
    });
    if (data.decision === 'invalidate') {
      await publishEvent(tx, {
        type: 'referral.invalidated',
        aggregateType: 'referral',
        aggregateId: referral.id,
        subjectMemberId: await inviterMemberId(tx, referral.inviterUserId),
        payload: { previousStatus: referral.status },
      });
    }
    return row;
  });
}
