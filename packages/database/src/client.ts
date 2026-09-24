import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

/**
 * Driver-agnostic database handle. Covers the production postgres-js driver,
 * the PGlite driver used in tests, and transactions of either.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseHandle {
  db: Database;
  /** Round-trip check used by health endpoints. Returns latency in ms. */
  ping: () => Promise<number>;
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  max?: number;
  /** Statement timeout guard in ms (applied per connection). */
  statementTimeoutMs?: number;
  applicationName?: string;
}

export function createDatabase(url: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: {
      application_name: options.applicationName ?? 'jave',
      statement_timeout: options.statementTimeoutMs ?? 15_000,
    },
  });
  const db = drizzle(client, { schema, casing: undefined }) as unknown as Database;
  return {
    db,
    ping: () => pingDatabase(db),
    close: () => client.end({ timeout: 5 }),
  };
}

export async function pingDatabase(db: Database): Promise<number> {
  const started = performance.now();
  await db.execute(sql`select 1`);
  return Math.round(performance.now() - started);
}

export { schema };
