/**
 * Pure view helpers for the analytics and referrals pages: ranges, labels,
 * chart points and number formatting. Client-safe (no server imports).
 */

/** Ranges offered by the analytics filter (days). Mirrors core's overview ranges. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

/** `?range=` → a supported range (default 30). */
export function parseRange(raw: string | undefined): AnalyticsRange {
  const value = Number(raw);
  return (ANALYTICS_RANGES as readonly number[]).includes(value)
    ? (value as AnalyticsRange)
    : DEFAULT_ANALYTICS_RANGE;
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DURATION_DECIMALS = 10;

/** Median hours → "18.5 h" / "2.3 d"; null → an em dash. */
export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours >= HOURS_PER_DAY * 2) {
    return `${Math.round((hours / HOURS_PER_DAY) * DURATION_DECIMALS) / DURATION_DECIMALS} d`;
  }
  return `${Math.round(hours * DURATION_DECIMALS) / DURATION_DECIMALS} h`;
}

/** Median minutes → "42 min" / "3.5 h"; null → an em dash. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes >= MINUTES_PER_HOUR * 2) return formatHours(minutes / MINUTES_PER_HOUR);
  return `${Math.round(minutes)} min`;
}

/** "+12" / "−3" / "0" with a true minus sign. */
export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** "1 ticket" / "3 tickets" (count grouped). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** snake_case enum value → "Sentence case" label. */
export function enumLabel(value: string): string {
  const words = value.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface SeriesPoint {
  day: string;
  value: number | null;
}

export interface DayPoint {
  key: string;
  label: string;
  value: number | null;
  secondary?: number | null;
}

/** Snapshot points → chart points (the ISO day doubles as the label). */
export function toChartPoints(points: readonly SeriesPoint[]): DayPoint[] {
  return points.map((point) => ({ key: point.day, label: point.day, value: point.value }));
}

/**
 * Joins above, leaves below, per day. A day counts as missing only when
 * neither flow was snapshotted.
 */
export function flowPoints(
  joins: readonly SeriesPoint[],
  leaves: readonly SeriesPoint[],
): DayPoint[] {
  const leavesByDay = new Map(leaves.map((point) => [point.day, point.value]));
  return joins.map((point) => {
    const leave = leavesByDay.get(point.day) ?? null;
    const missing = point.value === null && leave === null;
    return {
      key: point.day,
      label: point.day,
      value: missing ? null : (point.value ?? 0),
      secondary: missing ? null : (leave ?? 0),
    };
  });
}

/** Sum of the known values; null when the range has no snapshot at all. */
export function seriesTotal(points: readonly SeriesPoint[]): number | null {
  let total: number | null = null;
  for (const point of points) {
    if (point.value !== null) total = (total ?? 0) + point.value;
  }
  return total;
}

/** Last known value of a gauge series. */
export function latestValue(points: readonly SeriesPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i]!.value;
    if (value !== null) return value;
  }
  return null;
}

/** Days in the range that have a snapshot. */
export function coveredDays(points: readonly SeriesPoint[]): number {
  return points.filter((point) => point.value !== null).length;
}
