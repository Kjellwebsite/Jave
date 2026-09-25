import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { type Database, jobs } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { MINUTE } from '../kernel/clock';

export type JobRecord = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  maxAttempts?: number;
  /** At most one pending/running job per key. Duplicate enqueues are dropped. */
  dedupeKey?: string;
  /**
   * With `dedupeKey`, for jobs that re-sync from current state. When the live
   * job with this key is already running, its handler may have read the state
   * before the caller changed it, so instead of being dropped this request
   * makes that job run once more (with its own payload) when it ends. A
   * pending job is row-locked until the caller commits, so it cannot be
   * claimed before the change is visible.
   */
  rerunIfRunning?: boolean;
}

/** Attempts at inserting a job whose live same-key job keeps finishing under us. */
const RERUN_ENQUEUE_ATTEMPTS = 3;

/**
 * Enqueue a job in the caller's transaction. Returns the job id, or null when
 * a live job with the same dedupe key already exists.
 */
export async function enqueueJob(
  ctx: ServiceContext,
  type: string,
  payload: Record<string, unknown> = {},
  options: EnqueueOptions = {},
): Promise<number | null> {
  const now = ctx.clock.now();
  const runAt = options.runAt ?? new Date(now.getTime() + (options.delayMs ?? 0));
  for (let attempt = 0; attempt < RERUN_ENQUEUE_ATTEMPTS; attempt++) {
    const [row] = await ctx.db
      .insert(jobs)
      .values({
        type,
        payload,
        runAt,
        maxAttempts: options.maxAttempts ?? 5,
        dedupeKey: options.dedupeKey ?? null,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: jobs.dedupeKey,
        where: sql`${jobs.status} in ('pending', 'running')`,
      })
      .returning({ id: jobs.id });
    if (row) {
      ctx.effects.jobIds.push(row.id);
      return row.id;
    }
    if (!options.rerunIfRunning || !options.dedupeKey) return null;
    const [live] = await ctx.db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, options.dedupeKey), inArray(jobs.status, LIVE_JOB_STATUSES)))
      .for('update');
    if (!live) continue; // It finished meanwhile: insert a fresh one.
    if (live.status === 'running') {
      await ctx.db.update(jobs).set({ rerunRequested: true }).where(eq(jobs.id, live.id));
    }
    return null;
  }
  return null;
}

const LIVE_JOB_STATUSES: JobRecord['status'][] = ['pending', 'running'];

/** Queue the follow-up run a same-key enqueue asked for while `job` was running. */
async function enqueueRequestedRerun(
  db: Database,
  job: Pick<JobRecord, 'type' | 'payload' | 'dedupeKey' | 'maxAttempts'>,
  now: Date,
): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type: job.type,
      payload: job.payload,
      runAt: now,
      maxAttempts: job.maxAttempts,
      dedupeKey: job.dedupeKey,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: jobs.dedupeKey,
      where: sql`${jobs.status} in ('pending', 'running')`,
    });
}

/** Cancel live jobs by dedupe key (e.g. a rescheduled deadline). */
export async function cancelJob(ctx: ServiceContext, dedupeKey: string): Promise<number> {
  const rows = await ctx.db
    .update(jobs)
    .set({ status: 'cancelled', completedAt: ctx.clock.now() })
    .where(and(eq(jobs.dedupeKey, dedupeKey), eq(jobs.status, 'pending')))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Atomically claim up to `limit` due jobs (FOR UPDATE SKIP LOCKED). */
export async function claimJobs(
  db: Database,
  options: {
    workerId: string;
    limit: number;
    now: Date;
    ids?: number[];
    types?: readonly string[];
  },
): Promise<JobRecord[]> {
  return db.transaction(async (tx) => {
    const conditions = [eq(jobs.status, 'pending'), lte(jobs.runAt, options.now)];
    if (options.ids) conditions.push(inArray(jobs.id, options.ids));
    if (options.types) conditions.push(inArray(jobs.type, [...options.types]));
    const due = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(options.limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(jobs)
      .set({
        status: 'running',
        lockedAt: options.now,
        lockedBy: options.workerId,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(
        inArray(
          jobs.id,
          due.map((d) => d.id),
        ),
      )
      .returning();
  });
}

export async function completeJob(
  db: Database,
  id: number,
  now: Date,
  result?: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [done] = await tx
      .update(jobs)
      .set({
        status: 'completed',
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        result: result ?? null,
        lastError: null,
      })
      .where(eq(jobs.id, id))
      .returning();
    if (done?.rerunRequested) await enqueueRequestedRerun(tx, done, now);
  });
}

/** Exponential backoff with a cap: 10s, 20s, 40s … max 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 60 * MINUTE);
}

export async function failJob(
  db: Database,
  job: JobRecord,
  error: string,
  now: Date,
  options: { permanent?: boolean } = {},
): Promise<'retry' | 'dead'> {
  const exhausted = options.permanent || job.attempts >= job.maxAttempts;
  await db.transaction(async (tx) => {
    const [failed] = await tx
      .update(jobs)
      .set({
        status: exhausted ? 'dead' : 'pending',
        runAt: exhausted ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
        lockedAt: null,
        lockedBy: null,
        lastError: error.slice(0, 2000),
        completedAt: exhausted ? now : null,
      })
      .where(eq(jobs.id, job.id))
      .returning();
    if (!failed?.rerunRequested) return;
    // A retry re-reads current state anyway; a dead job still owes the requested run.
    if (exhausted) await enqueueRequestedRerun(tx, failed, now);
    else await tx.update(jobs).set({ rerunRequested: false }).where(eq(jobs.id, job.id));
  });
  return exhausted ? 'dead' : 'retry';
}

/** Return jobs whose worker died mid-run to the queue. */
export async function recoverStaleJobs(
  db: Database,
  now: Date,
  timeoutMs = 5 * MINUTE,
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'pending',
      lockedAt: null,
      lockedBy: null,
      lastError: 'recovered: worker lease expired',
      // Running again from the start covers any rerun that was requested.
      rerunRequested: false,
    })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, new Date(now.getTime() - timeoutMs))))
    .returning({ id: jobs.id });
  return rows.length;
}

export interface QueueStats {
  pending: number;
  running: number;
  dead: number;
  failedRecently: number;
  oldestPendingSeconds: number | null;
}

export async function getQueueStats(db: Database, now: Date): Promise<QueueStats> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending' and ${jobs.runAt} <= ${now})::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
      dead: sql<number>`count(*) filter (where ${jobs.status} = 'dead')::int`,
      failedRecently: sql<number>`count(*) filter (where ${jobs.status} = 'pending' and ${jobs.attempts} > 0)::int`,
      oldestPending: sql<Date | null>`min(${jobs.runAt}) filter (where ${jobs.status} = 'pending' and ${jobs.runAt} <= ${now})`,
    })
    .from(jobs);
  const oldest = row?.oldestPending ? new Date(row.oldestPending) : null;
  return {
    pending: row?.pending ?? 0,
    running: row?.running ?? 0,
    dead: row?.dead ?? 0,
    failedRecently: row?.failedRecently ?? 0,
    oldestPendingSeconds: oldest
      ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000))
      : null,
  };
}

/**
 * Enqueue a recurring job once per time bucket. The existence check covers
 * completed jobs too, so a bucket runs at most once even across workers.
 */
export async function enqueueRecurring(
  ctx: ServiceContext,
  type: string,
  everyMs: number,
  payload: Record<string, unknown> = {},
): Promise<number | null> {
  const bucket = Math.floor(ctx.clock.now().getTime() / everyMs);
  const dedupeKey = `recurring:${type}:${bucket}`;
  const existing = await ctx.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.dedupeKey, dedupeKey))
    .limit(1);
  if (existing.length > 0) return null;
  return enqueueJob(ctx, type, payload, { dedupeKey, maxAttempts: 3 });
}
