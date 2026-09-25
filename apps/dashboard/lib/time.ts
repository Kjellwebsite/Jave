const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_DAYS = 30;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${withTime}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function safeFormatter(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  try {
    return formatterFor(timeZone, withTime);
  } catch {
    return formatterFor('UTC', withTime);
  }
}

function parts(date: Date, timeZone: string, withTime: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of safeFormatter(timeZone, withTime).formatToParts(date))
    out[part.type] = part.value;
  return out;
}

/** `2026-09-24 14:03` in the viewer's time zone (UTC on an unknown zone). */
export function formatTimestamp(date: Date, timeZone = 'UTC'): string {
  const p = parts(date, timeZone, true);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** `2026-09-24` in the viewer's time zone. */
export function formatDate(date: Date, timeZone = 'UTC'): string {
  const p = parts(date, timeZone, false);
  return `${p.year}-${p.month}-${p.day}`;
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

/** Every IANA zone the runtime knows, UTC first. */
export function timeZoneOptions(): string[] {
  const zones = Intl.supportedValuesOf('timeZone');
  return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
}
