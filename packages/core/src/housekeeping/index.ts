import type { EventSubscriber } from '../events/bus';
import { DAY } from '../kernel/clock';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { pruneOperationalData } from './retention.service';

export {
  PRUNE_BATCH_SIZE,
  PRUNE_MAX_BATCHES,
  type PruneReport,
  pruneOperationalData,
  RETENTION_DAYS,
} from './retention.service';

/** Daily pruning of operational tables (see RETENTION_DAYS). */
export const HOUSEKEEPING_JOB = 'system.housekeeping';

export const jobHandlers: JobHandlerMap = {
  [HOUSEKEEPING_JOB]: async (ctx) => {
    const report = await pruneOperationalData(ctx);
    const total = Object.values(report).reduce((sum, count) => sum + count, 0);
    if (total > 0) ctx.logger.info({ report }, 'housekeeping pruned operational rows');
    return report;
  },
};

export const subscribers: readonly EventSubscriber[] = [];

export const recurringJobs: readonly RecurringJob[] = [{ type: HOUSEKEEPING_JOB, everyMs: DAY }];
