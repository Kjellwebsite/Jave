import { describe, expect, it } from 'vitest';
import { enumLabel, formatCountdown, formatEventTiming, formatRelative, ordinal } from './format';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('format', () => {
  it('formats countdowns at every scale', () => {
    expect(formatCountdown(-5)).toBe('00:00');
    expect(formatCountdown(9 * SECOND + 999)).toBe('00:09');
    expect(formatCountdown(4 * MINUTE + 9 * SECOND)).toBe('04:09');
    expect(formatCountdown(HOUR + 42 * MINUTE + 10 * SECOND)).toBe('01:42:10');
    expect(formatCountdown(2 * DAY + 4 * HOUR + MINUTE)).toBe('2d 04h');
  });

  it('formats coarse relative times', () => {
    expect(formatRelative(-2 * MINUTE)).toBe('overdue');
    expect(formatRelative(30 * SECOND)).toBe('now');
    expect(formatRelative(12 * MINUTE)).toBe('in 12m');
    expect(formatRelative(5 * HOUR)).toBe('in 5h');
    expect(formatRelative(3 * DAY)).toBe('in 3d');
  });

  it('BREAK: an event already running reads as running, never overdue', () => {
    const start = 10 * DAY;
    const end = start + 2 * HOUR;
    expect(formatEventTiming(start, end, start - 3 * DAY)).toBe('IN 3D');
    expect(formatEventTiming(start, end, start - 30 * SECOND)).toBe('NOW');
    expect(formatEventTiming(start, end, start + 20 * MINUTE)).toBe('ENDS IN 1H');
    expect(formatEventTiming(start, end, end - 12 * MINUTE)).toBe('ENDS IN 12M');
    expect(formatEventTiming(start, end, end - 30 * SECOND)).toBe('ENDING');
    expect(formatEventTiming(start, end, end)).toBe('ENDED');
    for (const now of [start, start + HOUR, end - SECOND]) {
      expect(formatEventTiming(start, end, now)).not.toBe('OVERDUE');
    }
  });

  it('labels enums and ordinals', () => {
    expect(enumLabel('teams_assigned')).toBe('TEAMS ASSIGNED');
    expect(enumLabel('engineering-history')).toBe('ENGINEERING HISTORY');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
});
