import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Database } from '@jave/database';
import { type ServiceContext } from '../kernel/context';
import { isJaveError } from '../kernel/errors';
import type { Logger } from '../kernel/logger';
import type { Clock } from '../kernel/clock';
import { claimJobs, completeJob, failJob, type JobRecord, recoverStaleJobs } from './queue';

/** Thrown by handlers for failures that retrying cannot fix (bad payload, missing entity). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export type JobHandler = (
  ctx: ServiceContext,
  payload: Record<string, unknown>,
  job: JobRecord,
) => Promise<Record<string, unknown> | void>;

export type JobHandlerMap = Readonly<Record<string, JobHandler>>;

export interface RecurringJob {
  type: string;
  everyMs: number;
  payload?: Record<string, unknown>;
}

export interface WorkerOptions {
  db: Database;
  handlers: JobHandlerMap;
  logger: Logger;
  clock: Clock;
  /** Builds a system-actor context for each job. */
  contextFor: (job: JobRecord) => ServiceContext;
  concurrency?: number;
  pollMs?: number;
  recurring?: readonly RecurringJob[];
  /** Hook to enqueue recurring jobs; injected to keep the worker free of domain imports. */
  scheduleRecurring?: (jobs: readonly RecurringJob[]) => Promise<void>;
}

export interface JobOutcome {
  id: number;
  type: string;
  status: 'completed' | 'retry' | 'dead';
  error?: string;
  result?: Record<string, unknown>;
}

/**
 * Polling job worker. Multiple workers (processes) may run concurrently;
 * claims use SKIP LOCKED so each job runs once per attempt.
 */
export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = 0;
  private lastTickAt: Date | null = null;
  private lastError: string | null = null;
  private tickPromise: Promise<void> | null = null;

  constructor(private readonly options: WorkerOptions) {}

  get handlerTypes(): string[] {
    return Object.keys(this.options.handlers);
  }

  status() {
    return {
      running: this.running,
      inFlight: this.inFlight,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      this.tickPromise = this.tick().then(
        () => undefined,
        (error: unknown) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.options.logger.error({ err: error }, 'worker tick failed');
        },
      );
      await this.tickPromise;
      if (this.running) this.timer = setTimeout(() => void loop(), this.options.pollMs ?? 1000);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.tickPromise;
  }

  /** One poll cycle: recover stale jobs, schedule recurring work, run due jobs. */
  async tick(): Promise<JobOutcome[]> {
    const now = this.options.clock.now();
    this.lastTickAt = now;
    await recoverStaleJobs(this.options.db, now);
    if (this.options.recurring?.length && this.options.scheduleRecurring) {
      await this.options.scheduleRecurring(this.options.recurring);
    }
    const capacity = Math.max(0, (this.options.concurrency ?? 4) - this.inFlight);
    if (capacity === 0) return [];
    const claimed = await claimJobs(this.options.db, {
      workerId: this.id,
      limit: capacity,
      now,
      types: this.handlerTypes,
    });
    return Promise.all(claimed.map((job) => this.execute(job)));
  }

  /**
   * Run specific jobs immediately (e.g. the Discord side effects of the
   * interaction that just committed). Jobs already claimed elsewhere are skipped.
   */
  async runNow(ids: readonly number[]): Promise<JobOutcome[]> {
    if (ids.length === 0) return [];
    const claimed = await claimJobs(this.options.db, {
      workerId: this.id,
      limit: ids.length,
      now: this.options.clock.now(),
      ids: [...ids],
      types: this.handlerTypes,
    });
    return Promise.all(claimed.map((job) => this.execute(job)));
  }

  /** Drain everything due, repeatedly — used by tests and the E2E simulator. */
  async drain(maxRounds = 20): Promise<JobOutcome[]> {
    const outcomes: JobOutcome[] = [];
    for (let round = 0; round < maxRounds; round++) {
      const batch = await this.tick();
      if (batch.length === 0) break;
      outcomes.push(...batch);
    }
    return outcomes;
  }

  private async execute(job: JobRecord): Promise<JobOutcome> {
    const handler = this.options.handlers[job.type];
    const log = this.options.logger.child({
      jobId: job.id,
      jobType: job.type,
      attempt: job.attempts,
    });
    this.inFlight++;
    try {
      if (!handler) throw new PermanentJobError(`no handler registered for ${job.type}`);
      const ctx = this.options.contextFor(job);
      const result = (await handler(ctx, job.payload, job)) ?? undefined;
      await completeJob(this.options.db, job.id, this.options.clock.now(), result);
      log.debug('job completed');
      return { id: job.id, type: job.type, status: 'completed', result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent =
        error instanceof PermanentJobError ||
        (isJaveError(error) &&
          ['VALIDATION', 'NOT_FOUND', 'FORBIDDEN', 'INVALID_STATE'].includes(error.code));
      const outcome = await failJob(this.options.db, job, message, this.options.clock.now(), {
        permanent,
      });
      log[outcome === 'dead' ? 'error' : 'warn']({ err: error, outcome }, 'job failed');
      return { id: job.id, type: job.type, status: outcome, error: message };
    } finally {
      this.inFlight--;
    }
  }
}
