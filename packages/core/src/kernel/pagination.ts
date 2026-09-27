import { type SQL, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '@jave/database';

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type PageInput = z.input<typeof pageSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Totals over tables that grow without bound (audit log, jobs) count at most
 * this many rows past the current page offset: an exact count would scan
 * every matching row on each page view.
 */
export const COUNT_CAP = 10_000;

/** A page whose total is exact unless `totalCapped`, which means "at least". */
export interface CappedPage<T> extends Page<T> {
  totalCapped: boolean;
}

/**
 * offset + the matching rows after it, counting at most `cap` of those
 * (+1 to know whether more exist). Paging deeper extends the total, so
 * every page stays reachable while each count stays bounded.
 */
export async function cappedCount(
  db: Database,
  table: PgTable,
  where: SQL | undefined,
  options: { offset?: number; cap?: number } = {},
): Promise<{ total: number; capped: boolean }> {
  const offset = options.offset ?? 0;
  const cap = options.cap ?? COUNT_CAP;
  const rows = db
    .select({ one: sql<number>`1`.as('one') })
    .from(table)
    .where(where)
    .offset(offset)
    .limit(cap + 1)
    .as('capped_rows');
  const [row] = await db.select({ matched: sql<number>`count(*)::int` }).from(rows);
  const matched = row?.matched ?? 0;
  return { total: offset + Math.min(matched, cap), capped: matched > cap };
}
