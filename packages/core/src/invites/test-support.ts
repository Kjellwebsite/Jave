/**
 * Shared fixtures for the invites and analytics integration tests.
 * Test-only: nothing in the domain layer imports this file.
 */
import type { TestKit } from '../testing';
import { MINUTE } from '../kernel/clock';
import { recordGuildJoin } from '../identity/users.service';

/**
 * Every integration test boots and migrates its own PGlite database. On a
 * heavily loaded shared machine the first boot (WASM compile) alone can take
 * over a minute, so these suites get a larger time budget than the package
 * defaults. Assertions are unchanged; only the time allowed is.
 * Apply at the top of a test file: `vi.setConfig(SLOW_DATABASE_TIMEOUTS)`.
 */
export const SLOW_DATABASE_TIMEOUTS = { hookTimeout: 3 * MINUTE, testTimeout: MINUTE } as const;

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n;
let sequence = 0n;

/** A Discord ID whose embedded creation time is `createdAt` (unique per call). */
export function snowflakeAt(createdAt: Date): string {
  sequence = (sequence + 1n) % 4096n;
  const ms = BigInt(createdAt.getTime()) - DISCORD_EPOCH_MS;
  return ((ms << SNOWFLAKE_TIMESTAMP_SHIFT) | sequence).toString();
}

export interface JoinOptions {
  username: string;
  /** Discord account creation time; defaults to years before the join. */
  accountCreatedAt?: Date;
  discordId?: string;
}

const OLD_ACCOUNT = new Date('2019-06-01T00:00:00Z');

/** Simulate the bot's guildMemberAdd → recordGuildJoin at the kit's current time. */
export async function joinGuild(kit: TestKit, options: JoinOptions) {
  const discordId = options.discordId ?? snowflakeAt(options.accountCreatedAt ?? OLD_ACCOUNT);
  return recordGuildJoin(kit.system, {
    discordId,
    username: options.username,
    displayName: options.username,
  });
}
