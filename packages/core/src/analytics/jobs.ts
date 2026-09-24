import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { DAY } from '../kernel/clock';
import { runAnalyticsSnapshot } from './snapshots.service';

/** Daily metrics snapshot (non-Discord; runs with the worker's system actor). */
export const ANALYTICS_SNAPSHOT_JOB = 'analytics.snapshot';

export const analyticsJobHandlers: JobHandlerMap = {
  [ANALYTICS_SNAPSHOT_JOB]: async (ctx, payload) => ({
    ...(await runAnalyticsSnapshot(ctx, payload)),
  }),
};

export const analyticsRecurringJobs: readonly RecurringJob[] = [
  { type: ANALYTICS_SNAPSHOT_JOB, everyMs: DAY },
];
