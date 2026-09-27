import { describe, expect, it } from 'vitest';
import { formatWallTime, parseScheduleTime, safeTimeZone, zonedToUtc } from './schedule-time';

// Thursday 2026-03-05 12:00 UTC.
const NOW = new Date('2026-03-05T12:00:00.000Z');
const iso = (input: string, zone = 'UTC') => parseScheduleTime(input, NOW, zone)?.toISOString();

describe('parseScheduleTime', () => {
  it('reads exact timestamps, with and without a zone', () => {
    expect(iso('2026-03-10T18:30:00Z')).toBe('2026-03-10T18:30:00.000Z');
    expect(iso('2026-03-10T18:30+02:00')).toBe('2026-03-10T16:30:00.000Z');
    expect(iso('2026-03-10 18:30 UTC', 'Europe/Oslo')).toBe('2026-03-10T18:30:00.000Z');
    expect(iso('2026-03-10 18:30', 'Europe/Oslo')).toBe('2026-03-10T17:30:00.000Z');
    expect(iso('2026-03-10 18:30 -0500')).toBe('2026-03-10T23:30:00.000Z');
  });

  it('reads natural day and clock forms in the staff member’s zone', () => {
    expect(iso('tomorrow 18:00')).toBe('2026-03-06T18:00:00.000Z');
    expect(iso('Tomorrow at 6pm')).toBe('2026-03-06T18:00:00.000Z');
    expect(iso('today 17:15')).toBe('2026-03-05T17:15:00.000Z');
    expect(iso('fri 17:30')).toBe('2026-03-06T17:30:00.000Z');
    // Same weekday: later today if still ahead, otherwise next week.
    expect(iso('thursday 13:00')).toBe('2026-03-05T13:00:00.000Z');
    expect(iso('thu 09:00')).toBe('2026-03-12T09:00:00.000Z');
    expect(iso('18:00')).toBe('2026-03-05T18:00:00.000Z');
    expect(iso('11:00')).toBe('2026-03-06T11:00:00.000Z');
    expect(iso('at 6:30 pm')).toBe('2026-03-05T18:30:00.000Z');
    expect(iso('tomorrow 18:00', 'America/New_York')).toBe('2026-03-06T23:00:00.000Z');
  });

  it('reads a zone suffix on natural forms too, as the modal promises', () => {
    // Thursday 12:00 UTC is 13:00 in Berlin.
    expect(iso('tomorrow 18:00 UTC', 'Europe/Berlin')).toBe('2026-03-06T18:00:00.000Z');
    expect(iso('fri 17:30 +02:00', 'Europe/Berlin')).toBe('2026-03-06T15:30:00.000Z');
    expect(iso('today 20:00 gmt', 'America/New_York')).toBe('2026-03-05T20:00:00.000Z');
    expect(iso('6pm Z', 'Asia/Tokyo')).toBe('2026-03-05T18:00:00.000Z');
    // 07:00 there now, so 9:15 is still ahead today.
    expect(iso('at 9:15 am -0500')).toBe('2026-03-05T14:15:00.000Z');
    expect(iso('18:00+02:00')).toBe('2026-03-05T16:00:00.000Z');
    // "tomorrow" is the next day in the zone given: Friday 00:30 in Tokyo already.
    expect(
      parseScheduleTime(
        'tomorrow 10:00 +09:00',
        new Date('2026-03-05T15:30:00.000Z'),
        'UTC',
      )?.toISOString(),
    ).toBe('2026-03-07T01:00:00.000Z');
  });

  it('reads relative offsets', () => {
    expect(iso('in 3 days')).toBe('2026-03-08T12:00:00.000Z');
    expect(iso('in 90 minutes')).toBe('2026-03-05T13:30:00.000Z');
    expect(iso('in 2h')).toBe('2026-03-05T14:00:00.000Z');
  });

  it('handles daylight-saving transitions', () => {
    // Europe/Oslo switches to CEST on 2026-03-29 at 02:00 local.
    expect(iso('2026-03-29 12:00', 'Europe/Oslo')).toBe('2026-03-29T10:00:00.000Z');
    expect(iso('2026-03-28 12:00', 'Europe/Oslo')).toBe('2026-03-28T11:00:00.000Z');
  });

  it('BREAK: rejects malformed, impossible and oversized input', () => {
    for (const input of [
      '',
      'soon',
      'next week',
      '2026-02-30 10:00',
      '2026-03-10',
      '2026-03-10 25:00',
      '2026-03-10 18:30 +15:00',
      'blursday 10:00',
      '13pm',
      'in 0 days',
      'in 5 fortnights',
      'in 99999 days',
      '<@123456789012345678> 18:00',
      `tomorrow ${'9'.repeat(80)}`,
      'tomorrow utc',
      'fri 17:30 +15:00',
      'tomorrow 18:00 CEST',
      'in 3 days utc',
      'utc',
    ]) {
      expect(parseScheduleTime(input, NOW, 'UTC'), input).toBeNull();
    }
  });

  it('falls back to UTC for an unknown zone', () => {
    expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(iso('tomorrow 18:00', 'Mars/Olympus_Mons')).toBe('2026-03-06T18:00:00.000Z');
  });
});

describe('zone helpers', () => {
  it('round-trips wall time', () => {
    const at = zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 5 }, 'Asia/Tokyo');
    expect(at.toISOString()).toBe('2026-07-01T00:05:00.000Z');
    expect(formatWallTime(at, 'Asia/Tokyo')).toBe('2026-07-01 09:05');
    expect(formatWallTime(at, 'nowhere')).toBe('2026-07-01 00:05');
  });
});
