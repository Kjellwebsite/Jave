import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './client';
import { applyReferenceData } from './reference-data';
import * as schema from './schema';

/**
 * Test harness: an in-process PostgreSQL (PGlite, real Postgres compiled to
 * WASM) with the committed migrations and reference data applied.
 *
 * Tests exercise the same SQL that production runs — no mocks. The migrated
 * data directory is snapshotted once per migration set and cached on disk
 * (keyed by a hash of the migrations and reference data), so every test
 * database — in every worker and every run — starts in milliseconds.
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

export interface TestDatabase {
  db: Database;
  pg: PGlite;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  migratedSnapshot ??= loadSnapshot();
  // Loading the cached data directory is measurably faster than PGlite.clone()
  // and an order of magnitude faster than running migrations.
  const pg = new PGlite({ loadDataDir: await migratedSnapshot });
  const db = drizzle(pg, { schema }) as unknown as Database;
  return { db, pg, close: () => pg.close() };
}
