import 'server-only';
import { count } from 'drizzle-orm';
import { can, type ServiceContext, trials as trialsModule } from '@jave/core';
import { trials } from '@jave/database';

export type TrialStatus = trialsModule.TrialStatus;

/** Trial staff read the staff view of any trial they have no stake in. */
export function isTrialStaff(ctx: ServiceContext): boolean {
  return can(ctx, 'canManageTrials') || can(ctx, 'canEvaluateTrials');
}

/**
 * Trials per status, for the list's filter counts and readouts. Trial staff
 * only (staff see every status through `listTrials` anyway); null otherwise.
 */
export async function trialStatusCounts(
  ctx: ServiceContext,
): Promise<Record<TrialStatus, number> | null> {
  if (!isTrialStaff(ctx)) return null;
  const rows = await ctx.db
    .select({ status: trials.status, value: count() })
    .from(trials)
    .groupBy(trials.status);
  const counts = Object.fromEntries(
    trialsModule.TRIAL_STATUSES.map((status) => [status, 0]),
  ) as Record<TrialStatus, number>;
  for (const row of rows) counts[row.status] = row.value;
  return counts;
}
