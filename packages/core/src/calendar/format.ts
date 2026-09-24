const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * Deterministic, locale-independent event time for notification copy,
 * e.g. "Thu 5 Mar 2026, 18:00 UTC". Surfaces with a viewer timezone render
 * their own local time from the ISO instant in the notification data.
 */
export function formatEventTime(date: Date): string {
  const weekday = WEEKDAYS[date.getUTCDay()];
  const month = MONTHS[date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}, ${pad2(
    date.getUTCHours(),
  )}:${pad2(date.getUTCMinutes())} UTC`;
}
