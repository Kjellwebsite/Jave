import { and, eq, lte, min, notInArray, sql } from 'drizzle-orm';
import { type Database, jobs } from '@jave/database';
import { DAY, HOUR, MINUTE, ManualClock } from '../kernel/clock';
import { TtlCache } from '../kernel/cache';
import { type CoreConfig, createContext, type ServiceContext, withActor } from '../kernel/context';
import { newRequestId } from '../kernel/ids';
import { silentLogger } from '../kernel/logger';
import { systemActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import { type JobHandler, type JobHandlerMap, type JobOutcome, Worker } from '../jobs/worker';
import { coreJobHandlers } from '../registry';
import { createJobHandlers as createResearchJobHandlers } from '../research/jobs';
import { NotConfiguredSidusClient } from '../research/sidus';
import { botStandIn } from './bot-stand-in';
import type { CastKey } from './cast';
import { SeededRandom } from './rng';

/**
 * The seed's stage: one database, a manual clock that walks the story from
 * the past to the anchor ("now" for the seeded organization), and the real
 * job queue drained as time passes — so deadline closes, reminders,
 * achievement awards and notifications happen when they would have.
 */

export interface SeededPerson {
  key: CastKey;
  userId: string;
  memberId: string;
  discordId: string;
}

export interface SeedRunOptions {
  db: Database;
  /** The end of the story. Everything seeded happens at or before it. */
  anchor: Date;
  /** Seed of the deterministic random choices. */
  rngSeed: string;
  config?: Partial<CoreConfig>;
}

/** The story starts this long before the anchor; the first `at()` moves forward from here. */
export const STORY_SPAN_DAYS = 180;
/** Guard against a job that keeps rescheduling itself inside the story window. */
const MAX_QUEUE_STEPS = 5_000;
/** A drain round per job: one job at a time keeps the seed deterministic. */
const MAX_DRAIN_ROUNDS = 100_000;

export class SeedRun {
  readonly db: Database;
  readonly anchor: Date;
  /** UTC midnight of the anchor's day: story times are "day N, hour H" on this grid. */
  readonly dayZero: Date;
  readonly clock: ManualClock;
  readonly rng: SeededRandom;
  readonly system: ServiceContext;
  /** Jobs that failed while the story ran (should stay empty). */
  readonly jobFailures: JobOutcome[] = [];
  private readonly people = new Map<CastKey, SeededPerson>();
  private readonly coreHandlers: JobHandlerMap;

  constructor(options: SeedRunOptions) {
    this.db = options.db;
    this.anchor = new Date(options.anchor);
    this.dayZero = new Date(Math.floor(this.anchor.getTime() / DAY) * DAY);
    this.clock = new ManualClock(new Date(this.anchor.getTime() - STORY_SPAN_DAYS * DAY));
    this.rng = new SeededRandom(options.rngSeed);
    const cache = new TtlCache(() => this.clock.now().getTime());
    this.system = createContext({
      db: options.db,
      actor: systemActor('development seed'),
      clock: this.clock,
      cache,
      logger: silentLogger,
      config: options.config,
    });
    this.coreHandlers = {
      ...coreJobHandlers(),
      // No network during the seed: metadata enrichment finds nothing and Sidus is not configured.
      ...createResearchJobHandlers({ resolvers: [], sidus: new NotConfiguredSidusClient() }),
    };
  }

  /** Day `days` (0 is the anchor's day, negative is earlier) at `hours` UTC → an instant. */
  time(days: number, hours = 0): Date {
    return new Date(this.dayZero.getTime() + days * DAY + hours * HOUR);
  }

  /** Let `minutes` pass. */
  async later(minutes: number): Promise<void> {
    await this.advanceTo(new Date(this.clock.now().getTime() + minutes * MINUTE));
  }

  /**
   * Walk the clock forward to `target`, running every job that falls due on
   * the way at the time it was due. The story never moves backwards.
   */
  async advanceTo(target: Date): Promise<void> {
    if (target.getTime() < this.clock.now().getTime()) {
      throw new Error(
        `seed timeline moved backwards: ${this.clock.now().toISOString()} → ${target.toISOString()}`,
      );
    }
    for (let step = 0; step < MAX_QUEUE_STEPS; step++) {
      const [next] = await this.db
        .select({ runAt: min(jobs.runAt) })
        .from(jobs)
        .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, target)));
      if (!next?.runAt) {
        this.clock.set(target);
        return;
      }
      if (next.runAt.getTime() > this.clock.now().getTime()) this.clock.set(next.runAt);
      await this.settle();
    }
    throw new Error(`seed job queue did not settle before ${target.toISOString()}`);
  }

  /** Run every job due now: core handlers, plus the stand-in for bot-side jobs. */
  async settle(): Promise<void> {
    const pendingBotTypes = await this.db
      .selectDistinct({ type: jobs.type })
      .from(jobs)
      .where(
        and(eq(jobs.status, 'pending'), notInArray(jobs.type, Object.keys(this.coreHandlers))),
      );
    const handlers: Record<string, JobHandler> = { ...this.coreHandlers };
    for (const { type } of pendingBotTypes) handlers[type] = botStandIn(type);
    const worker = new Worker({
      db: this.db,
      handlers,
      logger: silentLogger,
      clock: this.clock,
      contextFor: () => this.systemContext('job'),
      concurrency: 1,
    });
    const outcomes = await worker.drain(MAX_DRAIN_ROUNDS);
    this.jobFailures.push(...outcomes.filter((outcome) => outcome.status !== 'completed'));
  }

  /** A fresh system context (its own request id and effects). */
  systemContext(reason = 'development seed'): ServiceContext {
    return {
      ...withActor(this.system, systemActor(reason)),
      requestId: newRequestId(),
      effects: { jobIds: [] },
    };
  }

  register(person: SeededPerson): void {
    this.people.set(person.key, person);
  }

  person(key: CastKey): SeededPerson {
    const person = this.people.get(key);
    if (!person) throw new Error(`seed cast member ${key} has not joined yet`);
    return person;
  }

  /** A context acting as `key`, with roles and standing resolved as of now. */
  async as(key: CastKey): Promise<ServiceContext> {
    const actor = await resolveUserActor(this.system, this.person(key).userId);
    return { ...withActor(this.system, actor), requestId: newRequestId(), effects: { jobIds: [] } };
  }

  memberIds(keys: readonly CastKey[]): string[] {
    return keys.map((key) => this.person(key).memberId);
  }

  /** Total rows in `jobs` still pending (for the report). */
  async pendingJobCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.status, 'pending'));
    return row?.count ?? 0;
  }
}
