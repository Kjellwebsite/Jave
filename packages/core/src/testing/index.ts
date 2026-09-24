import { createTestDatabase, type TestDatabase } from '@jave/database/testing';
import type { Database } from '@jave/database';
import { ManualClock } from '../kernel/clock';
import { type CoreConfig, createContext, type ServiceContext, withActor } from '../kernel/context';
import { TtlCache } from '../kernel/cache';
import { type Actor, systemActor, type UserActor } from '../permissions/actor';
import type { OrgRole } from '../permissions/roles';
import { syncDiscordUser, resolveUserActor } from '../identity/users.service';
import { grantRoleUnchecked } from '../identity/roles.service';
import { type JobHandlerMap, type JobOutcome, Worker } from '../jobs/worker';
import { silentLogger } from '../kernel/logger';

/**
 * Test kit: an isolated Postgres (PGlite) per call, a manual clock, a system
 * context, and factories for members with roles.
 */
export interface TestKit {
  db: Database;
  database: TestDatabase;
  clock: ManualClock;
  cache: TtlCache;
  system: ServiceContext;
  /** Context acting as `actor`, sharing the kit's db/clock/cache. */
  as: (actor: Actor) => ServiceContext;
  /** Create a Discord user + member with the given roles; returns its actor. */
  member: (options?: MemberOptions) => Promise<UserActor>;
  /** Run all due jobs with the given handlers until the queue is empty. */
  drain: (handlers: JobHandlerMap) => Promise<JobOutcome[]>;
  close: () => Promise<void>;
}

export interface MemberOptions {
  roles?: OrgRole[];
  username?: string;
  discordId?: string;
  inGuild?: boolean;
}

let discordCounter = 100_000_000_000_000_000n;

export function nextDiscordId(): string {
  discordCounter += 4_194_304n * 1000n; // advances the embedded timestamp too
  return discordCounter.toString();
}

export async function createTestKit(config: Partial<CoreConfig> = {}): Promise<TestKit> {
  const database = await createTestDatabase();
  const clock = new ManualClock('2026-03-01T12:00:00.000Z');
  const cache = new TtlCache(() => clock.now().getTime());
  const system = createContext({
    db: database.db,
    actor: systemActor('test'),
    clock,
    cache,
    logger: silentLogger,
    config,
  });
  const as = (actor: Actor) => ({ ...withActor(system, actor), effects: { jobIds: [] } });

  const member = async (options: MemberOptions = {}): Promise<UserActor> => {
    const discordId = options.discordId ?? nextDiscordId();
    const username = options.username ?? `user${discordId.slice(-6)}`;
    const { user, member: m } = await syncDiscordUser(
      system,
      { discordId, username, displayName: username },
      { inGuild: options.inGuild ?? true },
    );
    for (const role of options.roles ?? []) {
      await grantRoleUnchecked(system, { memberId: m.id, role, reason: 'test fixture' });
    }
    return resolveUserActor(system, user.id);
  };

  const drain = async (handlers: JobHandlerMap) => {
    const worker = new Worker({
      db: database.db,
      handlers,
      logger: silentLogger,
      clock,
      contextFor: () => as(systemActor('job')),
      concurrency: 8,
    });
    return worker.drain();
  };

  return {
    db: database.db,
    database,
    clock,
    cache,
    system,
    as,
    member,
    drain,
    close: database.close,
  };
}
