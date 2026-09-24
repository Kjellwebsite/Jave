import { readdir, readFile } from 'node:fs/promises';
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
 * Tests exercise the same SQL that production runs — no mocks. A snapshot of
 * the migrated data directory is cached per worker so each test database
 * starts in milliseconds.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

let migratedSnapshot: Promise<Blob | File> | null = null;

async function readMigrationStatements(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const statements: string[] = [];
  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    statements.push(
      ...content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return statements;
}

async function buildSnapshot(): Promise<Blob | File> {
  const pg = new PGlite();
  for (const statement of await readMigrationStatements()) {
    await pg.exec(statement);
  }
  const db = drizzle(pg, { schema }) as unknown as Database;
  await applyReferenceData(db);
  const dump = await pg.dumpDataDir('none');
  await pg.close();
  return dump;
}

export interface TestDatabase {
  db: Database;
  pg: PGlite;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  migratedSnapshot ??= buildSnapshot();
  const snapshot = await migratedSnapshot;
  const pg = new PGlite({ loadDataDir: snapshot });
  const db = drizzle(pg, { schema }) as unknown as Database;
  return { db, pg, close: () => pg.close() };
}
