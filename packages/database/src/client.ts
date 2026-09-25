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
  serializeRawDates(client);
  return {
    db,
    ping: () => pingDatabase(db),
    close: () => client.end({ timeout: 5 }),
  };
}

/** Date-like type OIDs: date, timestamp, timestamptz. */
const DATE_TYPE_OIDS = [1082, 1114, 1184] as const;

/**
 * Call after `drizzle(client)`. drizzle's postgres-js adapter replaces the
 * driver's date serializers with pass-throughs, because drizzle maps column
 * values itself. A Date bound outside a column (`sql\`… < ${date}\``) then
 * reaches the wire as an object and the query fails ("Received an instance
 * of Date"), while PGlite, used by the default tests, accepts it. Sending such
 * Dates as ISO-8601 makes both drivers behave the same.
 */
export function serializeRawDates(client: postgres.Sql): void {
  const serializers = client.options.serializers as Record<number, (value: unknown) => unknown>;
  for (const oid of DATE_TYPE_OIDS) {
    const inner = serializers[oid];
    serializers[oid] = (value: unknown) =>
      value instanceof Date ? value.toISOString() : inner ? inner(value) : value;
  }
}

export async function pingDatabase(db: Database): Promise<number> {
  const started = performance.now();
  await db.execute(sql`select 1`);
  return Math.round(performance.now() - started);
}

export { schema };
