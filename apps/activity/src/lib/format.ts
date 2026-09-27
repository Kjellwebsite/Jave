const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CLOCK_DIGITS = 2;

const pad = (value: number) => String(value).padStart(CLOCK_DIGITS, '0');

/** Countdown for deadlines: `2d 04h`, `01:42:10`, `04:09`; `00:00` once passed. */
export function formatCountdown(ms: number): string {
  const remaining = Math.max(0, ms);
  if (remaining >= DAY) {
    const days = Math.floor(remaining / DAY);
    return `${days}d ${pad(Math.floor((remaining % DAY) / HOUR))}h`;
  }
  const totalSeconds = Math.floor(remaining / SECOND);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** Coarse remaining time for lists: `in 3d`, `in 5h`, `in 12m`, `now`, `overdue`. */
export function formatRelative(ms: number): string {
  if (ms < -MINUTE) return 'overdue';
  if (ms < MINUTE) return 'now';
  if (ms >= DAY) return `in ${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `in ${Math.floor(ms / HOUR)}h`;
  return `in ${Math.floor(ms / MINUTE)}m`;
}

/** `YYYY-MM-DD HH:mm` in the viewer's time zone (DESIGN.md timestamps). */
export function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `snake_case` / `kebab` enum values as calm uppercase labels: `teams_assigned` → `TEAMS ASSIGNED`. */
export function enumLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim().toUpperCase();
}

const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ORDINAL_RULES = new Intl.PluralRules('en-US', { type: 'ordinal' });

/** 1 → `1st`, 2 → `2nd`, 11 → `11th`. */
export function ordinal(value: number): string {
  return `${value}${ORDINAL_SUFFIX[ORDINAL_RULES.select(value)] ?? 'th'}`;
}
