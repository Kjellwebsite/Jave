import { and, desc, eq, like, not, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { jobs } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  InvalidStateError,
  isUniqueViolation,
  NotFoundError,
} from '../kernel/errors';
import { type CappedPage, cappedCount, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import {
  ADVERSARIAL_JOB_PATTERN,
  mayReadAdversarialRecords,
} from '../permissions/adversarial-visibility';
import { authorize } from '../permissions/authorize';
import type { JobRecord } from './queue';

/** Longest last-error excerpt returned by listings and kept in the retry audit entry. */
const ERROR_EXCERPT_LENGTH = 300;

export const listJobsSchema = pageSchema.extend({
  status: z.enum(['pending', 'running', 'completed', 'dead', 'cancelled']).default('dead'),
  type: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9_.-]+$/, 'job types are lowercase dotted names')
    .optional(),
});

/** A job as operators see it. Payloads are left out: they can carry member content. */
export interface JobSummary {
  id: number;
  type: string;
  status: JobRecord['status'];
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  dedupeKey: string | null;
  runAt: Date;
  createdAt: Date;
  completedAt: Date | null;
}

const excerpt = (text: string | null) =>
  text === null
    ? null
    : text.length > ERROR_EXCERPT_LENGTH
      ? `${text.slice(0, ERROR_EXCERPT_LENGTH)}…`
      : text;

function toSummary(row: JobRecord): JobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: excerpt(row.lastError),
    dedupeKey: row.dedupeKey,
    runAt: row.runAt,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/** ADVERSARIAL_JOB_PATTERN, in code. */
const isAdversarialJob = (type: string) => type.includes('adversarial.');

/**
 * Jobs by status, newest first (dead letters by default). canViewSystemStatus.
 * Adversarial jobs (and their errors) are left out, counts included, for
 * readers not entitled to adversarial records: a failed briefing names a role.
 */
export async function listJobs(
  ctx: ServiceContext,
  input: z.input<typeof listJobsSchema> = {},
): Promise<CappedPage<JobSummary>> {
  await authorize(ctx, 'canViewSystemStatus');
  const q = parseInput(listJobsSchema, input);
  const filters: SQL[] = [eq(jobs.status, q.status)];
  if (q.type) filters.push(eq(jobs.type, q.type));
  if (!(await mayReadAdversarialRecords(ctx)))
    filters.push(not(like(jobs.type, ADVERSARIAL_JOB_PATTERN)));
  const where = and(...filters);
  const [rows, total] = await Promise.all([
    ctx.db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(q.limit)
      .offset(q.offset),
    cappedCount(ctx.db, jobs, where, { offset: q.offset }),
  ]);
  return {
    items: rows.map(toSummary),
    total: total.total,
    totalCapped: total.capped,
    limit: q.limit,
    offset: q.offset,
  };
}

export const retryJobSchema = z.object({ jobId: z.coerce.number().int().positive() });

/**
 * Put a dead-lettered job back in the queue with a fresh attempt budget.
 * Re-runs its side effect, so it needs canManageSettings and is audited.
 * Handlers re-read current state, so a retry never replays a stale decision.
 */
export async function retryDeadJob(
  ctx: ServiceContext,
  input: z.input<typeof retryJobSchema>,
): Promise<JobSummary> {
  const { jobId } = parseInput(retryJobSchema, input);
  await authorize(ctx, 'canManageSettings', { type: 'job', id: String(jobId) });
  try {
    return await withTransaction(ctx, async (tx) => {
      const [job] = await tx.db.select().from(jobs).where(eq(jobs.id, jobId)).for('update');
      if (!job) throw new NotFoundError('Job');
      // Answers like a missing job: the type alone would name an adversarial role.
      if (isAdversarialJob(job.type) && !(await mayReadAdversarialRecords(tx)))
        throw new NotFoundError('Job');
      if (job.status !== 'dead')
        throw new InvalidStateError('Only dead-lettered jobs can be retried.');
      const now = tx.clock.now();
      const [retried] = await tx.db
        .update(jobs)
        .set({
          status: 'pending',
          attempts: 0,
          runAt: now,
          lockedAt: null,
          lockedBy: null,
          completedAt: null,
          rerunRequested: false,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      await recordAudit(tx, {
        action: 'job.retried',
        targetType: 'job',
        targetId: String(job.id),
        context: { type: job.type, attempts: job.attempts, lastError: excerpt(job.lastError) },
      });
      tx.effects.jobIds.push(job.id);
      return toSummary(retried!);
    });
  } catch (error) {
    // A live job with the same dedupe key already covers this work.
    if (isUniqueViolation(error)) throw new ConflictError('The same job is already queued.');
    throw error;
  }
}
