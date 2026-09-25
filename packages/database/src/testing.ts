import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { type Database, serializeRawDates } from './client';
import { applyReferenceData } from './reference-data';
import * as schema from './schema';

/**
 * Test harness: a fresh database per test with the committed migrations and
 * reference data applied. Tests exercise the same SQL that production runs —
 * no mocks.
 *
 * Two backends:
 * - `pglite` (default): in-process PostgreSQL compiled to WASM. The migrated
 *   data directory is snapshotted once per migration set and cached on disk
 *   (keyed by a hash of the migrations and reference data), so every test
 *   database starts in milliseconds. One connection, one transaction at a time.
 * - `postgres`: a real server through the production driver (postgres-js),
 *   with a connection pool, so driver behaviour and row-lock interleaving are
 *   exercised too. Set JAVE_TEST_BACKEND=postgres and JAVE_TEST_POSTGRES_URL
 *   to a role that may CREATE DATABASE. Each test database is cloned from a
 *   template database built once per migration set, and dropped on close.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

const CACHE_DIR = join(tmpdir(), 'jave-pglite-snapshots');
const REFERENCE_DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'reference-data.ts');

let migratedSnapshot: Promise<Blob> | null = null;

async function readMigrations(): Promise<{ statements: string[]; hash: string }> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const hash = createHash('sha256');
  const statements: string[] = [];
  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    hash.update(file).update(content);
    statements.push(
      ...content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  hash.update(await readFile(REFERENCE_DATA_FILE, 'utf8').catch(() => ''));
  return { statements, hash: hash.digest('hex').slice(0, 24) };
}

async function buildSnapshot(statements: string[]): Promise<Blob> {
  const pg = new PGlite();
  for (const statement of statements) {
    await pg.exec(statement);
  }
  const db = drizzle(pg, { schema }) as unknown as Database;
  await applyReferenceData(db);
  const dump = await pg.dumpDataDir('none');
  await pg.close();
  return dump;
}

/** Load the snapshot for the current migrations from disk, building it on a miss. */
async function loadSnapshot(): Promise<Blob> {
  const { statements, hash } = await readMigrations();
  const file = join(CACHE_DIR, `${hash}.tar`);
  const cached = await readFile(file).catch(() => null);
  if (cached) return new Blob([cached]);
  const snapshot = await buildSnapshot(statements);
  await mkdir(CACHE_DIR, { recursive: true });
  // Atomic publish: concurrent workers may race to build; the last rename wins harmlessly.
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temp, Buffer.from(await snapshot.arrayBuffer()));
  await rename(temp, file);
  return snapshot;
}

export type TestBackend = 'pglite' | 'postgres';

export const TEST_BACKEND_VARIABLE = 'JAVE_TEST_BACKEND';
export const TEST_POSTGRES_URL_VARIABLE = 'JAVE_TEST_POSTGRES_URL';

/** The backend selected by JAVE_TEST_BACKEND (default pglite). */
export function testBackend(): TestBackend {
  const backend = process.env[TEST_BACKEND_VARIABLE] || 'pglite';
  if (backend !== 'pglite' && backend !== 'postgres') {
    throw new Error(`${TEST_BACKEND_VARIABLE} must be "pglite" or "postgres", got "${backend}".`);
  }
  if (backend === 'postgres' && !process.env[TEST_POSTGRES_URL_VARIABLE]) {
    throw new Error(`${TEST_BACKEND_VARIABLE}=postgres needs ${TEST_POSTGRES_URL_VARIABLE}.`);
  }
  return backend;
}

export interface TestDatabase {
  db: Database;
  backend: TestBackend;
  /** Run raw SQL, several statements allowed (fault injection in tests). */
  exec: (sql: string) => Promise<void>;
  /** Another handle on the same database that reports every query it runs. */
  withQueryLog: (logQuery: (query: string) => void) => Database;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  return testBackend() === 'postgres' ? createPostgresTestDatabase() : createPgliteTestDatabase();
}

async function createPgliteTestDatabase(): Promise<TestDatabase> {
  migratedSnapshot ??= loadSnapshot();
  // Loading the cached data directory is measurably faster than PGlite.clone()
  // and an order of magnitude faster than running migrations.
  const pg = new PGlite({ loadDataDir: await migratedSnapshot });
  const db = drizzle(pg, { schema }) as unknown as Database;
  return {
    db,
    backend: 'pglite',
    exec: async (sql) => {
      await pg.exec(sql);
    },
    withQueryLog: (logQuery) =>
      drizzle(pg, { schema, logger: { logQuery } }) as unknown as Database,
    close: () => pg.close(),
  };
}

// ---------------------------------------------------------------------------
// Real Postgres backend
// ---------------------------------------------------------------------------

const TEMPLATE_PREFIX = 'jave_tpl_';
const TEST_DATABASE_PREFIX = 'jave_t_';
/** Connections per test database: enough for every transaction in a burst to run at once. */
const TEST_POOL_CONNECTIONS = 8;
/** Serializes template builds across workers and runs (pg_advisory_lock key). */
const TEMPLATE_LOCK_KEY = 0x6a617665;

let adminClient: postgres.Sql | null = null;
let templateName: Promise<string> | null = null;

function quiet(url: string, options: postgres.Options<Record<string, never>> = {}) {
  return postgres(url, { onnotice: () => undefined, ...options });
}

function databaseUrl(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function admin(adminUrl: string): postgres.Sql {
  adminClient ??= quiet(adminUrl, {
    max: 1,
    idle_timeout: 5,
    connection: { application_name: 'jave-test-admin' },
  });
  return adminClient;
}

/**
 * The template for the current migration set, built once. Names are derived
 * from hex hashes and random hex, so interpolating them into DDL is safe.
 */
async function ensureTemplate(adminUrl: string): Promise<string> {
  const { statements, hash } = await readMigrations();
  const name = `${TEMPLATE_PREFIX}${hash}`;
  const lock = await admin(adminUrl).reserve();
  try {
    await lock`select pg_advisory_lock(${TEMPLATE_LOCK_KEY})`;
    const [existing] = await lock`select 1 from pg_database where datname = ${name}`;
    if (existing) return name;
    const stale = await lock<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${TEMPLATE_PREFIX}%`}`;
    for (const { datname } of stale) {
      await lock.unsafe(`alter database ${datname} is_template false`);
      await lock.unsafe(`drop database if exists ${datname} with (force)`);
    }
    const building = `${name}_${randomBytes(4).toString('hex')}`;
    await lock.unsafe(`create database ${building}`);
    const client = quiet(databaseUrl(adminUrl, building), { max: 1 });
    try {
      for (const statement of statements) await client.unsafe(statement);
      await applyReferenceData(drizzlePostgres(client, { schema }) as unknown as Database);
    } finally {
      await client.end({ timeout: 5 });
    }
    await lock.unsafe(`alter database ${building} rename to ${name}`);
    await lock.unsafe(`alter database ${name} is_template true`);
    return name;
  } finally {
    await lock`select pg_advisory_unlock(${TEMPLATE_LOCK_KEY})`.catch(() => undefined);
    lock.release();
  }
}

const DROP_ATTEMPTS = 5;
const DROP_RETRY_MS = 200;

/**
 * DROP … WITH (FORCE) cannot terminate a backend of another role, such as an
 * autovacuum worker that just started on the database; it stops soon, so retry.
 */
async function dropTestDatabase(sql: postgres.Sql, name: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql.unsafe(`drop database if exists ${name} with (force)`);
      return;
    } catch (error) {
      if (attempt >= DROP_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, DROP_RETRY_MS * attempt));
    }
  }
}

async function createPostgresTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env[TEST_POSTGRES_URL_VARIABLE]!;
  templateName ??= ensureTemplate(adminUrl);
  const template = await templateName;
  const name = `${TEST_DATABASE_PREFIX}${randomBytes(8).toString('hex')}`;
  await admin(adminUrl).unsafe(`create database ${name} template ${template}`);
  const client = quiet(databaseUrl(adminUrl, name), {
    max: TEST_POOL_CONNECTIONS,
    idle_timeout: 5,
    connection: { application_name: 'jave-test' },
  });
  const db = drizzlePostgres(client, { schema }) as unknown as Database;
  serializeRawDates(client);
  let closed = false;
  return {
    db,
    backend: 'postgres',
    exec: async (sql) => {
      await client.unsafe(sql).simple();
    },
    withQueryLog: (logQuery) => {
      // Every drizzle() call resets the client's serializers, so re-apply the fix.
      const logged = drizzlePostgres(client, { schema, logger: { logQuery } });
      serializeRawDates(client);
      return logged as unknown as Database;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await client.end({ timeout: 5 });
      await dropTestDatabase(admin(adminUrl), name);
    },
  };
}
