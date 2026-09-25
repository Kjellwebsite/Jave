/**
 * Time windows and small numeric helpers for analytics. Pure.
 * Windows are half-open: [start, end).
 */
import { DAY } from '../kernel/clock';

export interface TimeWindow {
  start: Date;
  end: Date;
}

/** Overview ranges offered to staff. */
export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];
export const DEFAULT_RANGE_DAYS: RangeDays = 30;

/** Time-series ranges (a year of daily snapshots at most). */
export const SERIES_RANGE_DAYS = [7, 30, 90, 365] as const;
export type SeriesRangeDays = (typeof SERIES_RANGE_DAYS)[number];
export const DEFAULT_SERIES_RANGE_DAYS: SeriesRangeDays = 30;

/** Retention horizons reported by the overview (D7 / D30). */
export const RETENTION_HORIZON_DAYS = [7, 30] as const;

const RATE_PRECISION = 10_000;
const DURATION_PRECISION = 10;
const ISO_DAY_LENGTH = 10;

/** The `days`-long window ending at `end`. */
export function windowEndingAt(end: Date, days: number): TimeWindow {
  return { start: new Date(end.getTime() - days * DAY), end };
}

/** Shift a window back in time by `days`. */
export function shiftBack(window: TimeWindow, days: number): TimeWindow {
  return {
    start: new Date(window.start.getTime() - days * DAY),
    end: new Date(window.end.getTime() - days * DAY),
  };
}

/** Share rounded to four decimals; null when there is nothing to divide by. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * RATE_PRECISION) / RATE_PRECISION;
}

/** Round a duration (hours/minutes) to one decimal; null stays null. */
export function roundDuration(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * DURATION_PRECISION) / DURATION_PRECISION;
}

/** UTC calendar day of a timestamp, as YYYY-MM-DD. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, ISO_DAY_LENGTH);
}

/** Midnight UTC starting a YYYY-MM-DD day. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The [00:00, 24:00) UTC window of a YYYY-MM-DD day. */
export function dayWindow(day: string): TimeWindow {
  const start = dayStart(day);
  return { start, end: new Date(start.getTime() + DAY) };
}

/** Previous UTC day relative to `now`. */
export function previousDay(now: Date): string {
  return utcDay(new Date(dayStart(utcDay(now)).getTime() - DAY));
}

/** The `count` UTC days ending with (and including) `lastDay`, oldest first. */
export function daysEndingWith(lastDay: string, count: number): string[] {
  const last = dayStart(lastDay).getTime();
  return Array.from({ length: count }, (_, i) => utcDay(new Date(last - (count - 1 - i) * DAY)));
}

/** Every key of an enum with a count (0 when absent) — stable shapes for dashboards. */
export function tally<K extends string>(
  keys: readonly K[],
  rows: readonly { key: K | null; count: number }[],
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) if (row.key !== null && row.key in out) out[row.key] += row.count;
  return out;
}
