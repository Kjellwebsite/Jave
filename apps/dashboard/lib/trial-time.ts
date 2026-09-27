/**
 * Time helpers for the trials pages. Staff type schedule times as wall-clock
 * time in their own time zone (their JAVE preference); services store UTC.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SECOND_MS = 1000;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function safeZone(timeZone: string): string {
  try {
    offsetFormatter(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** Milliseconds the zone is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of offsetFormatter(timeZone).formatToParts(new Date(instant)))
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return asUtc - (instant - (instant % SECOND_MS));
}

/**
 * `2026-10-01T18:30` typed in `timeZone` → the UTC instant, or null when
 * malformed. Across a DST gap the time shifts forward with the clock.
 */
export function zonedInputToDate(value: string, timeZone: string): Date | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month! - 1 || check.getUTCDate() !== day!) return null;
  const zone = safeZone(timeZone);
  const first = wall - zoneOffsetMs(wall, zone);
  const second = wall - zoneOffsetMs(first, zone);
  return new Date(second);
}

/** The `datetime-local` value for `date` as seen in `timeZone`. */
export function dateToZonedInput(date: Date, timeZone: string): string {
  const zone = safeZone(timeZone);
  const shifted = new Date(date.getTime() + zoneOffsetMs(date.getTime(), zone));
  return shifted.toISOString().slice(0, 16);
}

/** "2d 4h", "3h 12m", "12m 05s" (seconds only in the last hour), "45s" — or null once passed. */
export function countdownLabel(msRemaining: number): string | null {
  if (msRemaining <= 0) return null;
  const days = Math.floor(msRemaining / DAY_MS);
  const hours = Math.floor((msRemaining % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((msRemaining % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((msRemaining % MINUTE_MS) / SECOND_MS);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
