/**
 * Parses the interview time staff type into a Discord modal. Accepts exact
 * forms (ISO 8601, `2026-10-02 18:00`) and a few natural ones
 * (`tomorrow 18:00`, `fri 17:30`, `in 3 days`, `6pm`). Any form with a
 * clock time may end in `UTC`, `GMT`, `Z` or an offset such as `+02:00`;
 * without one it is read in the staff member's configured time zone, and
 * with one, `today`, `tomorrow` and weekdays are days in that zone too.
 * Pure: no I/O, `now` is injected.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DAYS_PER_WEEK = 7;
const HOURS_PER_HALF_DAY = 12;
const MAX_INPUT_CHARS = 64;
/** "in N days" beyond this is never a sensible interview; core caps the horizon anyway. */
const MAX_RELATIVE_AMOUNT = 1000;

export const SCHEDULE_TIME_EXAMPLES = '2026-10-02 18:00 · tomorrow 18:00 · fri 17:30 · in 3 days';

const WEEKDAYS: Readonly<Record<string, number>> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const RELATIVE_UNITS: Readonly<Record<string, number>> = {
  m: MINUTE_MS,
  min: MINUTE_MS,
  mins: MINUTE_MS,
  minute: MINUTE_MS,
  minutes: MINUTE_MS,
  h: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,
  d: DAY_MS,
  day: DAY_MS,
  days: DAY_MS,
};

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

interface ClockTime {
  hour: number;
  minute: number;
}

type CalendarDay = Pick<WallTime, 'year' | 'month' | 'day'>;

/** Where a time without a date is read: the staff member's IANA zone, or an offset they typed. */
type ReadingZone = { kind: 'named'; timeZone: string } | { kind: 'offset'; offsetMs: number };

/** `Z`, `UTC`, `GMT` or `±HH:MM` / `±HHMM` at the end of the input. */
const ZONE_SUFFIX_SOURCE = String.raw`z|utc|gmt|[+-]\d{2}:?\d{2}`;
const TRAILING_ZONE = new RegExp(String.raw`^(.*?)\s*(${ZONE_SUFFIX_SOURCE})$`);
/** Offsets beyond this do not exist on Earth (UTC+14 is the easternmost). */
const MAX_OFFSET_HOURS = 14;
const MAX_MINUTE = 59;

/** The zone if the runtime knows it, else UTC. */
export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function wallClock(instant: number, timeZone: string): WallTime & { second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** How far the zone's wall clock is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time in `timeZone` denotes (DST gaps resolve forward). */
export function zonedToUtc(wall: WallTime, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  let instant = guess - firstOffset;
  const secondOffset = zoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;
  return new Date(instant);
}

/** `2026-10-02 18:00` in the given zone — the modal prefill format. */
export function formatWallTime(date: Date, timeZone: string): string {
  const wall = wallClock(date.getTime(), safeTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isValidClock(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= MAX_MINUTE;
}

/** `18:00`, `9:30`, `6pm`, `6:30 pm`. */
function parseClock(text: string): ClockTime | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (!meridiem && match[2] === undefined) return null;
  if (meridiem) {
    if (hour < 1 || hour > HOURS_PER_HALF_DAY) return null;
    hour = (hour % HOURS_PER_HALF_DAY) + (meridiem === 'pm' ? HOURS_PER_HALF_DAY : 0);
  }
  return isValidClock(hour, minute) ? { hour, minute } : null;
}

/** `Z`, `UTC`, `GMT`, `+02:00`, `-0530` → offset in ms; undefined when absent. */
function parseZoneSuffix(text: string | undefined): number | null | undefined {
  if (text === undefined || text === '') return undefined;
  if (text === 'z' || text === 'utc' || text === 'gmt') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > MAX_OFFSET_HOURS || minutes > MAX_MINUTE) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (hours * HOUR_MS + minutes * MINUTE_MS);
}

function addDays(wall: CalendarDay, days: number): CalendarDay {
  const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** The calendar day it is at `instant` in the reading zone. */
function todayIn(instant: number, zone: ReadingZone): CalendarDay {
  if (zone.kind === 'named') return wallClock(instant, zone.timeZone);
  const shifted = new Date(instant + zone.offsetMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The instant a wall-clock time in the reading zone denotes. */
function instantIn(wall: WallTime, zone: ReadingZone): Date {
  if (zone.kind === 'named') return zonedToUtc(wall, zone.timeZone);
  return new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - zone.offsetMs,
  );
}

const ABSOLUTE = new RegExp(
  String.raw`^(\d{4})-(\d{2})-(\d{2})(?:[t\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?\s*(${ZONE_SUFFIX_SOURCE})?$`,
);

function parseAbsolute(text: string, timeZone: string): Date | null {
  const match = ABSOLUTE.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (match[4] === undefined) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!isValidDate(year, month, day) || !isValidClock(hour, minute)) return null;
  const offset = parseZoneSuffix(match[7]);
  if (offset === null) return null;
  if (offset !== undefined) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset);
  }
  return zonedToUtc({ year, month, day, hour, minute }, timeZone);
}

function parseRelative(text: string, now: Date): Date | null {
  const match = /^in\s+(\d{1,4})\s*([a-z]+)$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = RELATIVE_UNITS[match[2] ?? ''];
  if (!unit || amount < 1 || amount > MAX_RELATIVE_AMOUNT) return null;
  return new Date(now.getTime() + amount * unit);
}

/** Splits a trailing zone off natural input; `zone` is null when it names no valid offset. */
function splitZone(
  text: string,
  timeZone: string,
): { rest: string; zone: ReadingZone | null } | null {
  const match = TRAILING_ZONE.exec(text);
  if (!match || match[1] === undefined || match[1] === '')
    return { rest: text, zone: { kind: 'named', timeZone } };
  // The zone must follow a clock: `18:00 utc`, `6pm+02:00`, never a bare word.
  if (!/[\dm]$/.test(match[1])) return null;
  const offsetMs = parseZoneSuffix(match[2]);
  if (offsetMs === null || offsetMs === undefined) return { rest: match[1], zone: null };
  return { rest: match[1], zone: { kind: 'offset', offsetMs } };
}

function parseDayAndClock(input: string, now: Date, timeZone: string): Date | null {
  const split = splitZone(input, timeZone);
  if (!split?.zone) return null;
  const { rest, zone } = split;
  const match = /^(?:([a-z]+)\s+)?(?:at\s+)?(.+)$/.exec(rest.replace(/^at\s+/, ''));
  if (!match) return null;
  const clock = parseClock(match[2] ?? '');
  if (!clock) return null;
  const today = todayIn(now.getTime(), zone);
  const word = match[1];
  const at = (days: number) => instantIn({ ...addDays(today, days), ...clock }, zone);
  if (word === undefined) {
    const sameDay = at(0);
    return sameDay.getTime() > now.getTime() ? sameDay : at(1);
  }
  if (word === 'today') return at(0);
  if (word === 'tomorrow') return at(1);
  const weekday = WEEKDAYS[word];
  if (weekday === undefined) return null;
  const todayIndex = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const ahead = (weekday - todayIndex + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const candidate = at(ahead);
  return candidate.getTime() > now.getTime() ? candidate : at(ahead + DAYS_PER_WEEK);
}

/**
 * The instant `input` names, or null when it is not a recognised form.
 * Range checks (how far ahead) belong to the service, not here.
 */
export function parseScheduleTime(input: string, now: Date, timeZone: string): Date | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === '' || text.length > MAX_INPUT_CHARS) return null;
  const zone = safeTimeZone(timeZone);
  return parseAbsolute(text, zone) ?? parseRelative(text, now) ?? parseDayAndClock(text, now, zone);
}
