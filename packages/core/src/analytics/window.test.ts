import { describe, expect, it } from 'vitest';
import { DAY } from '../kernel/clock';
import {
  dayWindow,
  daysEndingWith,
  previousDay,
  rate,
  roundDuration,
  shiftBack,
  tally,
  utcDay,
  windowEndingAt,
} from './window';

describe('analytics windows and math', () => {
  const now = new Date('2026-06-30T12:00:00.000Z');

  it('builds half-open windows and shifts them', () => {
    const w = windowEndingAt(now, 7);
    expect(w.start.toISOString()).toBe('2026-06-23T12:00:00.000Z');
    expect(w.end).toBe(now);
    const shifted = shiftBack(w, 30);
    expect(shifted.end.getTime()).toBe(now.getTime() - 30 * DAY);
    expect(shifted.end.getTime() - shifted.start.getTime()).toBe(7 * DAY);
  });

  it('rates are null on empty denominators and rounded to 4 decimals', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(2, 3)).toBe(0.6667);
    expect(rate(5, 5)).toBe(1);
    expect(rate(1, -1)).toBeNull();
  });

  it('rounds durations and rejects non-finite values', () => {
    expect(roundDuration(71.96)).toBe(72);
    expect(roundDuration(null)).toBeNull();
    expect(roundDuration(Number.NaN)).toBeNull();
  });

  it('handles UTC days, including month and leap boundaries', () => {
    expect(utcDay(new Date('2026-06-30T23:59:59.999Z'))).toBe('2026-06-30');
    expect(previousDay(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-06-30');
    expect(previousDay(new Date('2028-03-01T10:00:00.000Z'))).toBe('2028-02-29');
    const w = dayWindow('2026-06-29');
    expect(w.end.getTime() - w.start.getTime()).toBe(DAY);
    expect(daysEndingWith('2026-03-02', 3)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('tally fills every enum key and ignores unknown or null keys', () => {
    const out = tally(['a', 'b', 'c'] as const, [
      { key: 'a', count: 2 },
      { key: null, count: 9 },
      { key: 'zzz' as 'a', count: 5 },
    ]);
    expect(out).toEqual({ a: 2, b: 0, c: 0 });
  });
});
