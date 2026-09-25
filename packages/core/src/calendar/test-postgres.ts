import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { applyReferenceData, createDatabase } from '@jave/database';
import { TtlCache } from '../kernel/cache';
import { ManualClock } from '../kernel/clock';
import { createContext, type ServiceContext, withActor } from '../kernel/context';
import { silentLogger } from '../kernel/logger';
import { grantRoleUnchecked } from '../identity/roles.service';
import { resolveUserActor, syncDiscordUser } from '../identity/users.service';
import { type Actor, systemActor, type UserActor } from '../permissions/actor';
import type { OrgRole } from '../permissions/roles';
import { nextDiscordId } from '../testing';

/**
 * Test-only, opt-in. PGlite runs one transaction at a time, so row locks can
 * only be exercised under real interleaving on a real Postgres server. Set
 * this variable to a URL whose role may CREATE DATABASE (e.g. the local dev
 * server) to run the `*.pg.test.ts` suites; unset, they are skipped.
 */
export const POSTGRES_TEST_URL_VARIABLE = 'JAVE_TEST_POSTGRES_URL';

/** Pool size: enough connections for every transaction in a burst to run at once. */
const TEST_POOL_CONNECTIONS = 20;
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../database/drizzle', import.meta.url));
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const TEST_DATABASE_PREFIX = 'jave_locktest_';
const TEST_DATABASE_SUFFIX_BYTES = 6;

export interface PostgresKit {
  system: ServiceContext;
  clock: ManualClock;
  as: (actor: Actor) => ServiceContext;
  member: (roles?: OrgRole[]) => Promise<UserActor>;
  close: () => Promise<void>;
}

async function migrationStatements(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const statements: string[] = [];
  for (const file of files) {
    const content = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
    statements.push(
      ...content
        .split(STATEMENT_BREAKPOINT)
        .map((statement) => statement.trim())
        .filter(Boolean),
    );
  }
  return statements;
}

/**
 * A throwaway database (created, migrated, seeded with reference data) on the
 * server at `adminUrl`, dropped again by `close`. The name is random hex, so
 * interpolating it into DDL is safe.
 */
export async function createPostgresKit(adminUrl: string): Promise<PostgresKit> {
  const name = `${TEST_DATABASE_PREFIX}${randomBytes(TEST_DATABASE_SUFFIX_BYTES).toString('hex')}`;
  const admin = createDatabase(adminUrl, { max: 1, applicationName: 'jave-locktest' });
  await admin.db.execute(sql.raw(`create database ${name}`));
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const handle = createDatabase(url.toString(), {
    max: TEST_POOL_CONNECTIONS,
    applicationName: 'jave-locktest',
  });
  for (const statement of await migrationStatements()) {
    await handle.db.execute(sql.raw(statement));
  }
  await applyReferenceData(handle.db);

  const clock = new ManualClock('2026-03-01T12:00:00.000Z');
  const cache = new TtlCache(() => clock.now().getTime());
  const system = createContext({
    db: handle.db,
    actor: systemActor('test'),
    clock,
    cache,
    logger: silentLogger,
  });
  const as = (actor: Actor) => ({ ...withActor(system, actor), effects: { jobIds: [] } });
  const member = async (roles: OrgRole[] = []): Promise<UserActor> => {
    const discordId = nextDiscordId();
    const username = `user${discordId.slice(-6)}`;
    const { user, member: created } = await syncDiscordUser(
      system,
      { discordId, username, displayName: username },
      { inGuild: true },
    );
    for (const role of roles) {
      await grantRoleUnchecked(system, { memberId: created.id, role, reason: 'test fixture' });
    }
    return resolveUserActor(system, user.id);
  };
  const close = async () => {
    await handle.close();
    await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
    await admin.close();
  };
  return { system, clock, as, member, close };
}
