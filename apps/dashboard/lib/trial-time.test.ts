import { describe, expect, it } from 'vitest';
import { countdownLabel, dateToZonedInput, zonedInputToDate } from './trial-time';

describe('trial time helpers', () => {
  it('reads wall-clock input in the viewer’s zone, across DST', () => {
    expect(zonedInputToDate('2026-01-15T18:30', 'UTC')!.toISOString()).toBe(
      '2026-01-15T18:30:00.000Z',
    );
    expect(zonedInputToDate('2026-01-15T18:30', 'Europe/Berlin')!.toISOString()).toBe(
      '2026-01-15T17:30:00.000Z',
    );
    expect(zonedInputToDate('2026-07-15T18:30', 'Europe/Berlin')!.toISOString()).toBe(
      '2026-07-15T16:30:00.000Z',
    );
    expect(zonedInputToDate('2026-07-15T09:00', 'America/Los_Angeles')!.toISOString()).toBe(
      '2026-07-15T16:00:00.000Z',
    );
    // 02:30 does not exist in Berlin on 2026-03-29: it lands after the jump.
    const gap = zonedInputToDate('2026-03-29T02:30', 'Europe/Berlin')!;
    expect(gap.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('BREAK: malformed input and unknown zones never throw', () => {
    for (const bad of ['', 'tomorrow', '2026-02-30T10:00', '2026-13-01T10:00', '2026-01-01 10:00'])
      expect(zonedInputToDate(bad, 'UTC'), bad).toBeNull();
    expect(zonedInputToDate('2026-01-15T18:30', 'Mars/Olympus')!.toISOString()).toBe(
      '2026-01-15T18:30:00.000Z',
    );
  });

  it('round-trips a date into the input format', () => {
    const date = new Date('2026-07-15T16:30:00.000Z');
    expect(dateToZonedInput(date, 'Europe/Berlin')).toBe('2026-07-15T18:30');
    expect(zonedInputToDate(dateToZonedInput(date, 'Asia/Kolkata'), 'Asia/Kolkata')).toEqual(date);
  });

  it('formats countdowns', () => {
    const second = 1000;
    const minute = 60 * second;
    const hour = 60 * minute;
    expect(countdownLabel(0)).toBeNull();
    expect(countdownLabel(-5)).toBeNull();
    expect(countdownLabel(45 * second)).toBe('45s');
    expect(countdownLabel(12 * minute + 5 * second)).toBe('12m 05s');
    expect(countdownLabel(3 * hour + 7 * minute)).toBe('3h 07m');
    expect(countdownLabel(50 * hour)).toBe('2d 2h');
    expect(countdownLabel(48 * hour)).toBe('2d');
  });
});
