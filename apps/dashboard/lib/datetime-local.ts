/**
 * `<input type="datetime-local">` values (`2026-10-02T18:00`) carry no zone.
 * The dashboard reads and writes them in the viewer's preferred time zone,
 * the same zone every timestamp on the page is shown in.
 */

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MS_PER_SECOND = 1000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zoneOrUtc(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function wallClock(instant: number, timeZone: string): WallClock {
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

/** How far the zone's wall clock runs ahead of UTC at `instant`. */
function offsetMs(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND;
}

/** The value a datetime-local input shows for `date` in `timeZone`. */
export function toDatetimeLocal(date: Date, timeZone: string): string {
  const wall = wallClock(date.getTime(), zoneOrUtc(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * The instant a datetime-local value denotes in `timeZone`, or null when the
 * value is malformed or names an impossible date. Times inside a
 * daylight-saving gap resolve forward.
 */
export function fromDatetimeLocal(value: string, timeZone: string): Date | null {
  const match = DATETIME_LOCAL.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > MAX_HOUR || minute > MAX_MINUTE) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const zone = zoneOrUtc(timeZone);
  const first = offsetMs(guess, zone);
  let instant = guess - first;
  const second = offsetMs(instant, zone);
  if (second !== first) instant = guess - second;
  return new Date(instant);
}
