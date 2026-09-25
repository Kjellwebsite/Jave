import { and, gte, lt, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { TimeWindow } from './window';

/** `count(*) filter (where …)` as an int. */
export function countWhere(condition: SQL | undefined): SQL<number> {
  return sql<number>`count(*) filter (where ${condition})::int`;
}

/** Column value inside the half-open window. Parameters bind through the column's codec. */
export function within(column: PgColumn, window: TimeWindow): SQL {
  return and(gte(column, window.start), lt(column, window.end))!;
}

/**
 * Median of `end - start` in the given unit over rows matching `condition`
 * (Postgres percentile_cont). Null when no row matches.
 */
export function medianDuration(
  start: PgColumn,
  end: PgColumn,
  unitSeconds: number,
  condition: SQL | undefined,
): SQL<number | null> {
  return sql<
    number | null
  >`(percentile_cont(0.5) within group (order by extract(epoch from (${end} - ${start}))::float8) filter (where ${condition})) / ${unitSeconds}::float8`.mapWith(
    Number,
  );
}

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
