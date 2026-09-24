import { and, asc, inArray, lte } from 'drizzle-orm';
import { verifications } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import type { JobHandler } from '../jobs/worker';
import { authorize } from '../permissions/authorize';
import { enqueueQueueCard } from './discord-jobs';
import { notifySubject } from './notices';
import { lockVerification, updateVerificationFrom } from './repository';
import { isOpen, isPastExpiry, OPEN_STATUSES, verificationReference } from './rules';

export const VERIFICATION_EXPIRE_JOB = 'verification.expire';
/** How often the recurring sweep runs. */
export const VERIFICATION_EXPIRY_SWEEP_EVERY_MS = 15 * MINUTE;
/** Rows expired per batch; each row commits in its own transaction. */
export const EXPIRY_BATCH_SIZE = 100;
/** Upper bound of batches per run; the next run continues where this one stopped. */
export const EXPIRY_MAX_BATCHES = 10;

export interface ExpirySweepResult {
  expired: number;
  failed: number;
}

/** Expire one verification if it is still open and past its expiry. Returns whether it did. */
async function expireOne(ctx: ServiceContext, id: string, now: Date): Promise<boolean> {
  return withTransaction(ctx, async (tx) => {
    const current = await lockVerification(tx, id);
    if (!isOpen(current.status) || !isPastExpiry(current.expiresAt, now) || !current.expiresAt)
      return false;
    const updated = await updateVerificationFrom(tx, id, OPEN_STATUSES, { status: 'expired' });
    const reference = verificationReference(current.number);
    await recordAudit(tx, {
      action: 'verification.expired',
      targetType: 'verification',
      targetId: id,
      context: { reference, type: current.type, from: current.status },
    });
    await publishEvent(tx, {
      type: 'verification.expired',
      aggregateType: 'verification',
      aggregateId: id,
      subjectMemberId: current.subjectMemberId,
      payload: { verificationId: id, reference, type: current.type, from: current.status },
    });
    await notifySubject(tx, current, {
      kind: 'expired',
      requestedAt: current.requestedAt,
      expiresAt: current.expiresAt,
    });
    await enqueueQueueCard(tx, updated);
    return true;
  });
}

/**
 * Expire every pending / in-review verification whose expiresAt has passed
 * (inclusive). One transaction per row, so one failure never blocks the rest.
 */
export async function expireDueVerifications(ctx: ServiceContext): Promise<ExpirySweepResult> {
  await authorize(ctx, 'canVerifyMembers', { type: 'verification' });
  const now = ctx.clock.now();
  const result: ExpirySweepResult = { expired: 0, failed: 0 };
  for (let batch = 0; batch < EXPIRY_MAX_BATCHES; batch++) {
    const due = await ctx.db
      .select({ id: verifications.id })
      .from(verifications)
      .where(and(inArray(verifications.status, OPEN_STATUSES), lte(verifications.expiresAt, now)))
      .orderBy(asc(verifications.expiresAt), asc(verifications.number))
      .limit(EXPIRY_BATCH_SIZE);
    let progressed = 0;
    for (const { id } of due) {
      try {
        if (await expireOne(ctx, id, now)) progressed++;
      } catch (error) {
        result.failed++;
        ctx.logger.error({ err: error, verificationId: id }, 'failed to expire verification');
      }
    }
    result.expired += progressed;
    if (due.length < EXPIRY_BATCH_SIZE || progressed === 0) break;
  }
  return result;
}

/** Recurring job: runs with the worker's system actor. Failures make the job retry. */
export const expireVerificationsJob: JobHandler = async (ctx) => {
  const result = await expireDueVerifications(ctx);
  if (result.failed > 0)
    throw new Error(`${result.failed} verification(s) failed to expire; ${result.expired} expired`);
  return { ...result };
};
