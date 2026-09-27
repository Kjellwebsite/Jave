import { and, inArray, isNotNull, lt, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  jobs,
  notificationDeliveries,
  outboundDeliveries,
  rateLimitBuckets,
  sessions,
  webhookDeliveries,
} from '@jave/database';
import { DAY } from '../kernel/clock';
import type { ServiceContext } from '../kernel/context';

/**
 * How long operational rows are kept after they stop mattering. The
 * organization's record is never pruned here: audit logs, domain events
 * (achievement criteria and analytics count them), notifications (the
 * inbox), cases, rank history and applications stay.
 */
export const RETENTION_DAYS = {
  completedJobs: 14,
  deadJobs: 30,
  endedSessions: 30,
  rateLimitBuckets: 8,
  deliveryLogs: 90,
} as const;

/** Rows deleted per statement, so one run never holds long locks. */
export const PRUNE_BATCH_SIZE = 5_000;
/** Batches per table per run; the next daily run continues. */
export const PRUNE_MAX_BATCHES = 20;

export type PruneReport = Record<
  | 'completedJobs'
  | 'deadJobs'
  | 'endedSessions'
  | 'rateLimitBuckets'
  | 'notificationDeliveries'
  | 'webhookDeliveries'
  | 'outboundDeliveries',
  number
>;

/** Delete matching rows in bounded batches, keyed by the table's primary key. */
async function pruneInBatches(
  ctx: ServiceContext,
  table: PgTable,
  key: PgColumn,
  where: SQL,
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
    const doomed = ctx.db.select({ key }).from(table).where(where).limit(PRUNE_BATCH_SIZE);
    const rows = await ctx.db.delete(table).where(inArray(key, doomed)).returning({ key });
    deleted += rows.length;
    if (rows.length < PRUNE_BATCH_SIZE) break;
  }
  return deleted;
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/** Prune operational tables past their retention. Idempotent; safe to run any time. */
export async function pruneOperationalData(ctx: ServiceContext): Promise<PruneReport> {
  const now = ctx.clock.now();
  const deliveryCutoff = daysAgo(now, RETENTION_DAYS.deliveryLogs);
  const sessionCutoff = daysAgo(now, RETENTION_DAYS.endedSessions);
  return {
    completedJobs: await pruneInBatches(
      ctx,
      jobs,
      jobs.id,
      and(
        inArray(jobs.status, ['completed', 'cancelled']),
        lt(jobs.completedAt, daysAgo(now, RETENTION_DAYS.completedJobs)),
      )!,
    ),
    deadJobs: await pruneInBatches(
      ctx,
      jobs,
      jobs.id,
      and(
        inArray(jobs.status, ['dead']),
        lt(jobs.completedAt, daysAgo(now, RETENTION_DAYS.deadJobs)),
      )!,
    ),
    endedSessions: await pruneInBatches(
      ctx,
      sessions,
      sessions.id,
      or(
        lt(sessions.expiresAt, sessionCutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionCutoff)),
      )!,
    ),
    rateLimitBuckets: await pruneInBatches(
      ctx,
      rateLimitBuckets,
      rateLimitBuckets.key,
      lt(rateLimitBuckets.windowStart, daysAgo(now, RETENTION_DAYS.rateLimitBuckets)),
    ),
    notificationDeliveries: await pruneInBatches(
      ctx,
      notificationDeliveries,
      notificationDeliveries.id,
      and(
        inArray(notificationDeliveries.status, ['sent', 'failed', 'skipped']),
        lt(notificationDeliveries.createdAt, deliveryCutoff),
      )!,
    ),
    webhookDeliveries: await pruneInBatches(
      ctx,
      webhookDeliveries,
      webhookDeliveries.id,
      and(
        inArray(webhookDeliveries.status, ['processed', 'ignored', 'failed', 'dead']),
        lt(webhookDeliveries.receivedAt, deliveryCutoff),
      )!,
    ),
    outboundDeliveries: await pruneInBatches(
      ctx,
      outboundDeliveries,
      outboundDeliveries.id,
      and(
        inArray(outboundDeliveries.status, ['processed', 'ignored', 'failed', 'dead']),
        lt(outboundDeliveries.createdAt, deliveryCutoff),
      )!,
    ),
  };
}
