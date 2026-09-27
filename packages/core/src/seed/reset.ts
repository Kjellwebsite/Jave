import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { applyReferenceData, type Database, members, schema } from '@jave/database';

/**
 * Database-level helpers for the seed CLI. Deliberately raw: emptying a
 * database is not a domain operation, and no service may offer it.
 */

/** Members already in the database (the seed refuses a non-empty organization). */
export async function existingMemberCount(db: Database): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(members);
  return row?.count ?? 0;
}

/** Every table of the JAVE schema, as quoted `schema.table` identifiers. */
export function javeTables(): string[] {
  const names = Object.values(schema)
    .filter((value): value is PgTable => is(value, PgTable))
    .map((table) => {
      const config = getTableConfig(table);
      return `"${config.schema ?? 'public'}"."${config.name}"`;
    });
  return [...new Set(names)].sort();
}

/**
 * Delete every row of every JAVE table (identities restarted), then restore
 * the reference data. Migrations are untouched. Callers must have checked
 * `seedRefusal(… reset: true)` first.
 */
export async function resetDatabase(db: Database): Promise<number> {
  const tables = javeTables();
  await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
  await applyReferenceData(db);
  return tables.length;
}
