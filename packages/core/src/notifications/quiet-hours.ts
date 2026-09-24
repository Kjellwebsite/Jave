import type { NotificationSeverity } from './catalog';

export interface QuietHours {
  timezone: string;
  /** Minutes after local midnight. */
  start: number;
  end: number;
}

/** Minutes after local midnight for `date` in `timezone` (falls back to UTC on bad zones). */
export function localMinutes(date: Date, timezone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

export function isWithinQuietHours(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * When a push notification should be delivered. Critical notifications ignore
 * quiet hours. Returns `now` when delivery can happen immediately.
 */
export function deliverAfter(
  now: Date,
  severity: NotificationSeverity,
  quiet: QuietHours | null,
): Date {
  if (!quiet || severity === 'critical') return now;
  const minutes = localMinutes(now, quiet.timezone);
  if (!isWithinQuietHours(minutes, quiet.start, quiet.end)) return now;
  const wait = (quiet.end - minutes + 1440) % 1440;
  return new Date(now.getTime() + wait * 60_000);
}
