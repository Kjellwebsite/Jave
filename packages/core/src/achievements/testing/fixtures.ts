import { eq, sql } from 'drizzle-orm';
import { jobs, memberAchievements } from '@jave/database';
import type { TestKit } from '../../testing';
import { TtlCache } from '../../kernel/cache';
import { createContext } from '../../kernel/context';
import { silentLogger } from '../../kernel/logger';
import { createEventHandlers, publishEvent } from '../../events/bus';
import type { DomainEventType } from '../../events/catalog';
import { type JobHandlerMap, type JobOutcome, Worker } from '../../jobs/worker';
import { systemActor } from '../../permissions/actor';
import { updateSettings } from '../../settings/settings.service';
import { jobHandlers, subscribers } from '../index';

/**
 * Timeouts for suites that build a migrated PGlite database per test. The
 * first createTestKit() in a worker can take more than a minute on a loaded
 * CI runner; apply with `vi.setConfig(DATABASE_SUITE_TIMEOUTS)` at the top of
 * the file. Only time limits change, never assertions.
 */
export const DATABASE_SUITE_TIMEOUTS = { hookTimeout: 240_000, testTimeout: 120_000 } as const;

/** Achievement job handlers with the rule engine subscribed. */
export const achievementTestHandlers = { ...jobHandlers, ...createEventHandlers(subscribers) };

export const ACHIEVEMENTS_CHANNEL = '123456789012345678';

/** Publish `times` events of `type` about `memberId` (null = no subject). */
export async function emitEvents(
  kit: TestKit,
  type: DomainEventType,
  memberId: string | null,
  times = 1,
) {
  for (let i = 0; i < times; i++) {
    await publishEvent(kit.system, {
      type,
      aggregateType: 'test',
      aggregateId: `agg-${i}`,
      subjectMemberId: memberId,
    });
  }
}

export async function awardsOf(kit: TestKit, memberId: string) {
  return kit.db.select().from(memberAchievements).where(eq(memberAchievements.memberId, memberId));
}

/** Keys of the member's non-revoked awards, sorted. */
export async function activeKeys(kit: TestKit, memberId: string) {
  return (await awardsOf(kit, memberId))
    .filter((row) => row.revokedAt === null)
    .map((row) => row.achievementKey)
    .sort();
}

export async function jobsOfType(kit: TestKit, type: string) {
  return kit.db.select().from(jobs).where(eq(jobs.type, type));
}

export async function enableAnnouncements(kit: TestKit) {
  await updateSettings(kit.system, 'channels', { achievements: ACHIEVEMENTS_CHANNEL });
  await updateSettings(kit.system, 'notifications', { announceAchievements: true });
}

/**
 * A job worker standing in for another process (the bot's worker, when
 * staff edit rules from the dashboard): same database and clock, but its own
 * in-process cache, as a separate process would have. Returns its drain.
 */
export function otherProcessWorker(
  kit: TestKit,
  handlers: JobHandlerMap,
): () => Promise<JobOutcome[]> {
  const cache = new TtlCache(() => kit.clock.now().getTime());
  const worker = new Worker({
    db: kit.db,
    handlers,
    logger: silentLogger,
    clock: kit.clock,
    contextFor: () =>
      createContext({
        db: kit.db,
        actor: systemActor('other process worker'),
        clock: kit.clock,
        cache,
        logger: silentLogger,
      }),
  });
  return () => worker.drain();
}

const INJECTABLE_JOB_TYPE = /^[a-z][a-z0-9_.]*$/;

/**
 * Failure injection: every insert of a job of `type` fails inside Postgres,
 * as a dropped connection or a constraint error would. Returns the function
 * that removes the fault.
 */
export async function failJobInserts(kit: TestKit, type: string): Promise<() => Promise<void>> {
  if (!INJECTABLE_JOB_TYPE.test(type)) throw new Error(`Unexpected job type: ${type}`);
  await kit.db.execute(
    sql.raw(`create or replace function test_fail_job_insert() returns trigger
      language plpgsql as $$ begin raise exception 'injected failure: % job insert', new.type; end $$`),
  );
  await kit.db.execute(
    sql.raw(`create trigger test_fail_job_insert before insert on jobs for each row
      when (new.type = '${type}') execute function test_fail_job_insert()`),
  );
  return async () => {
    await kit.db.execute(sql.raw('drop trigger test_fail_job_insert on jobs'));
  };
}
