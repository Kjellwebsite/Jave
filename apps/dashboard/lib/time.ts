const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_DAYS = 30;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** A calendar day as typed into `<input type="date">`; years 1000–9999. */
const ISO_DAY = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;

type Precision = 'day' | 'minute' | 'second';

const PRECISION_FIELDS: Record<Precision, Intl.DateTimeFormatOptions> = {
  day: {},
  minute: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  second: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string, precision: Precision): Intl.DateTimeFormat {
  const key = `${timeZone}|${precision}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...PRECISION_FIELDS[precision],
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function safeFormatter(timeZone: string, precision: Precision): Intl.DateTimeFormat {
  try {
    return formatterFor(timeZone, precision);
  } catch {
    return formatterFor('UTC', precision);
  }
}

function parts(date: Date, timeZone: string, precision: Precision): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of safeFormatter(timeZone, precision).formatToParts(date))
    out[part.type] = part.value;
  return out;
}

/** `2026-09-24 14:03` in the viewer's time zone (UTC on an unknown zone). */
export function formatTimestamp(date: Date, timeZone = 'UTC'): string {
  const p = parts(date, timeZone, 'minute');
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `2026-09-24` in the viewer's time zone. */
export function formatDate(date: Date, timeZone = 'UTC'): string {
  const p = parts(date, timeZone, 'day');
  return `${p.year}-${p.month}-${p.day}`;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms (0 on an unknown zone). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = parts(new Date(instant), timeZone, 'second');
  const wallClock = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  const wholeSeconds = instant - (((instant % 1000) + 1000) % 1000);
  return wallClock - wholeSeconds;
}

/** First instant of `day` (YYYY-MM-DD) in `timeZone`; null when `day` is not a real date. */
function startOfZonedDay(day: string, timeZone: string): number | null {
  const match = ISO_DAY.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const midnightUtc = Date.UTC(year, month, date);
  const check = new Date(midnightUtc);
  if (check.getUTCMonth() !== month || check.getUTCDate() !== date) return null;
  // Two passes settle the offset around a DST change; where local midnight is
  // skipped or repeated, the earliest instant that is already on `day` wins.
  const first = midnightUtc - zoneOffsetMs(midnightUtc, timeZone);
  const second = midnightUtc - zoneOffsetMs(first, timeZone);
  const onDay = [first, second].filter(
    (instant) => formatDate(new Date(instant), timeZone) === day,
  );
  return onDay.length > 0 ? Math.min(...onDay) : Math.max(first, second);
}

/**
 * The instants bounding calendar day `day` (YYYY-MM-DD) in `timeZone`, both
 * inclusive (`end` is the last millisecond). Null when `day` is not a real
 * date. Unknown zones read as UTC, matching how timestamps are displayed.
 */
export function zonedDayBounds(day: string, timeZone: string): { start: Date; end: Date } | null {
  const start = startOfZonedDay(day, timeZone);
  if (start === null) return null;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
  const nextStart = startOfZonedDay(next, timeZone);
  if (nextStart === null) return null;
  return { start: new Date(start), end: new Date(nextStart - 1) };
}

/** `just now` · `5m ago` · `3h ago` · `2d ago`, then an absolute date. */
export function formatRelative(date: Date, now: Date, timeZone = 'UTC'): string {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < RELATIVE_LIMIT_DAYS * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return formatDate(date, timeZone);
}

/** Minutes after midnight → `HH:MM` for `<input type="time">`. */
export function minutesToTime(minutes: number): string {
  const clamped = ((Math.trunc(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(clamped / MINUTES_PER_HOUR);
  const rest = clamped % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** `HH:MM` → minutes after midnight, or null when malformed. */
export function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/** True when Intl can format in `timeZone` (the same test core applies before storing one). */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every canonical IANA zone the runtime lists, UTC first. `current` (the
 * stored preference) is always offered: valid aliases such as Asia/Kolkata,
 * Europe/Kyiv or Etc/UTC are not in the runtime's list, and a select without
 * a matching option would silently fall back to UTC and save that.
 */
export function timeZoneOptions(current?: string): string[] {
  const zones = Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC');
  if (current && current !== 'UTC' && !zones.includes(current) && isKnownTimeZone(current)) {
    const at = zones.findIndex((zone) => zone > current);
    zones.splice(at === -1 ? zones.length : at, 0, current);
  }
  return ['UTC', ...zones];
}
