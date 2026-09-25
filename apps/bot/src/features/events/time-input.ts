/**
 * Start-time input for the /events create modal. Discord has no date picker,
 * so staff type the time. Accepted, in order:
 * - a Discord timestamp: `<t:1767225600>` or `<t:1767225600:F>`;
 * - ISO 8601 with an explicit offset: `2026-10-02T18:00:00+02:00`, `…Z`;
 * - local wall time in the member's time zone: `2026-10-02 18:00`.
 * Pure and locale-independent; the confirmation shows the result as a Discord
 * timestamp, which every viewer sees in their own time zone.
 */

const DISCORD_TIMESTAMP = /^<t:(\d{1,12})(?::[tTdDfFR])?>$/;
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;
const MS_PER_SECOND = 1000;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MONTHS_PER_YEAR = 12;
/** Input longer than any accepted form is rejected before parsing. */
export const START_INPUT_MAX = 40;

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallTimeIn(instant: number, timeZone: string): WallTime {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
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

/** The zone's offset from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  return asUtc(wallTimeIn(instant, timeZone)) - instant;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which `wall` is shown on clocks in `timeZone`. A wall time
 * skipped by a DST change resolves to the instant just after the gap.
 */
export function wallTimeToInstant(wall: WallTime, timeZone: string): Date {
  const target = asUtc(wall);
  const first = target - offsetAt(target, timeZone);
  const second = target - offsetAt(first, timeZone);
  const exact = [first, second].filter(
    (candidate) => asUtc(wallTimeIn(candidate, timeZone)) === target,
  );
  // Two exact candidates: a repeated hour (DST ends) → the later one. None: a skipped hour.
  return new Date(Math.max(...(exact.length > 0 ? exact : [first, second])));
}

function parseWallTime(match: RegExpExecArray): WallTime | null {
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > MONTHS_PER_YEAR || hour > MAX_HOUR || minute > MAX_MINUTE) return null;
  // Reject impossible days (2026-02-30) rather than letting Date roll them over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

/** Parse a start time; null when the text is not one of the accepted forms. */
export function parseStartInput(input: string, timeZone: string): Date | null {
  const text = input.trim();
  if (text.length === 0 || text.length > START_INPUT_MAX) return null;
  const timestamp = DISCORD_TIMESTAMP.exec(text);
  if (timestamp) return new Date(Number(timestamp[1]) * MS_PER_SECOND);
  if (ISO_WITH_OFFSET.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const local = LOCAL_WALL_TIME.exec(text);
  if (!local) return null;
  const wall = parseWallTime(local);
  if (!wall) return null;
  return wallTimeToInstant(wall, isValidTimeZone(timeZone) ? timeZone : 'UTC');
}
