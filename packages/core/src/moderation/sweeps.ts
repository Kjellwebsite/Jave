import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { modCases } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, InvalidStateError } from '../kernel/errors';
import type { JobHandler } from '../jobs/worker';
import { executeCase } from './case-engine';
import { SWEEP_BATCH_SIZE } from './constants';
import { caseReference } from './copy';
import { loadTarget, requireSystemActor } from './targets';

export const SWEEP_EXPIRED_JOB = 'moderation.sweep_expired';

export interface SweepResult {
  timeoutsClosed: number;
  quarantinesReleased: number;
  /** Already released or revoked by staff while the sweep ran. */
  skipped: number;
  /** Unexpected errors (logged); retried on the next run. */
  failed: number;
}

/**
 * Close timeouts Discord already lifted, and release quarantines whose
 * duration has passed: a `release` case by the system, standing restored,
 * and a Discord job that removes the quarantine role.
 */
export async function sweepExpiredCases(ctx: ServiceContext): Promise<SweepResult> {
  await requireSystemActor(ctx, { type: 'mod_case', id: null });
  const now = ctx.clock.now();
  const closed = await ctx.db
    .update(modCases)
    .set({ endedAt: now, endedReason: 'expired' })
    .where(
      and(
        eq(modCases.action, 'timeout'),
        isNull(modCases.endedAt),
        isNotNull(modCases.expiresAt),
        lte(modCases.expiresAt, now),
      ),
    )
    .returning({ id: modCases.id });

  const due = await ctx.db
    .select()
    .from(modCases)
    .where(
      and(
        eq(modCases.action, 'quarantine'),
        isNull(modCases.endedAt),
        isNotNull(modCases.expiresAt),
        lte(modCases.expiresAt, now),
      ),
    )
    .orderBy(asc(modCases.expiresAt))
    .limit(SWEEP_BATCH_SIZE);

  let released = 0;
  let skipped = 0;
  let failed = 0;
  for (const record of due) {
    try {
      const target = await loadTarget(ctx, { userId: record.targetUserId });
      await executeCase(ctx, {
        action: 'release',
        target,
        reason: `Quarantine expired (${caseReference(record.number)}).`,
        source: 'system',
        endReason: 'expired',
      });
      released++;
    } catch (error) {
      if (error instanceof ConflictError || error instanceof InvalidStateError) {
        // Released or revoked concurrently by staff: nothing left to do.
        skipped++;
        continue;
      }
      // Each release is its own transaction: one bad record must not block the rest.
      ctx.logger.error({ err: error, caseId: record.id }, 'quarantine release failed');
      failed++;
    }
  }
  if (failed > 0 && released === 0 && skipped === 0) {
    // Nothing progressed: fail the job so the error is visible and retried.
    throw new Error(`quarantine sweep: all ${failed} releases failed`);
  }
  return { timeoutsClosed: closed.length, quarantinesReleased: released, skipped, failed };
}

export const sweepExpiredHandler: JobHandler = async (ctx) => {
  const result = await sweepExpiredCases(ctx);
  return { ...result };
};
