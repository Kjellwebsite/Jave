/**
 * `<input type="datetime-local">` values are wall-clock times without a zone.
 * The dashboard interprets them in the viewer's time zone (their preference)
 * and shows stored instants back in that zone. Pure and locale-independent.
 */

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/;
const MONTHS_PER_YEAR = 12;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const FALLBACK_ZONE = 'UTC';

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone itself when the runtime knows it, otherwise UTC. */
export function knownTimeZone(timeZone: string): string {
  try {
    zoneFormatter(timeZone);
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

function wallTimeAt(instant: number, timeZone: string): WallTime {
  const parts: Record<string, string> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(instant))) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const asUtc = (wall: WallTime) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);

/**
 * The instant shown as `wall` on clocks in `timeZone`. A time skipped by a
 * DST change resolves to the instant just after the gap; a repeated hour to
 * the later occurrence.
 */
function wallTimeToInstant(wall: WallTime, timeZone: string): Date {
  const target = asUtc(wall);
  const offsetAt = (instant: number) => asUtc(wallTimeAt(instant, timeZone)) - instant;
  const first = target - offsetAt(target);
  const second = target - offsetAt(first);
  const exact = [first, second].filter(
    (candidate) => asUtc(wallTimeAt(candidate, timeZone)) === target,
  );
  return new Date(Math.max(...(exact.length > 0 ? exact : [first, second])));
}

/** A datetime-local value in `timeZone` → the instant; null when blank or malformed. */
export function parseDateTimeLocal(value: string, timeZone: string): Date | null {
  const match = DATETIME_LOCAL.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > MONTHS_PER_YEAR || hour > MAX_HOUR || minute > MAX_MINUTE) return null;
  // Reject impossible days (2026-02-30) instead of letting Date roll them over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return wallTimeToInstant({ year, month, day, hour, minute }, knownTimeZone(timeZone));
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** An instant as a datetime-local value (`2026-10-02T18:00`) in `timeZone`. */
export function toDateTimeLocal(date: Date, timeZone: string): string {
  const wall = wallTimeAt(date.getTime(), knownTimeZone(timeZone));
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}T${pad2(wall.hour)}:${pad2(wall.minute)}`;
}
