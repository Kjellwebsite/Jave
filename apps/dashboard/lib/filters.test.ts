import { describe, expect, it } from 'vitest';
import { describeRejectedFilters, parseAuditFilters } from './audit-filters';
import { formatTimestamp, isKnownTimeZone, timeZoneOptions, zonedDayBounds } from './time';

const ACTOR_ID = '0b7d3f5e-1c2a-4d8e-9f10-112233445566';

describe('time zone options', () => {
  it('lists UTC first, once', () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe('UTC');
    expect(zones.filter((zone) => zone === 'UTC')).toHaveLength(1);
    expect(zones).toContain('Europe/Berlin');
  });

  it('BREAK: always offers the stored zone, even an alias the runtime does not list', () => {
    for (const alias of ['Asia/Kolkata', 'Europe/Kyiv', 'Etc/UTC']) {
      expect(isKnownTimeZone(alias), alias).toBe(true);
      const zones = timeZoneOptions(alias);
      expect(zones, alias).toContain(alias);
      expect(zones.filter((zone) => zone === alias), alias).toHaveLength(1);
    }
    // Sorted in place, not appended at the end.
    const zones = timeZoneOptions('Asia/Kolkata');
    const at = zones.indexOf('Asia/Kolkata');
    expect(zones[at - 1]! < 'Asia/Kolkata').toBe(true);
    expect(zones[at + 1]! > 'Asia/Kolkata').toBe(true);
  });

  it('does not offer a zone Intl cannot use (it is shown, and saved, as UTC)', () => {
    expect(isKnownTimeZone('Not/AZone')).toBe(false);
    expect(timeZoneOptions('Not/AZone')).not.toContain('Not/AZone');
    expect(timeZoneOptions('Europe/Berlin')).toEqual(timeZoneOptions());
  });
});

describe('zoned day bounds', () => {
  it('bounds a UTC day', () => {
    expect(zonedDayBounds('2026-09-25', 'UTC')).toEqual({
      start: new Date('2026-09-25T00:00:00.000Z'),
      end: new Date('2026-09-25T23:59:59.999Z'),
    });
  });

  it('bounds a day in the viewer zone, where the timestamps are displayed', () => {
    const bounds = zonedDayBounds('2026-09-25', 'Europe/Berlin')!;
    expect(bounds.start.toISOString()).toBe('2026-09-24T22:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-09-25T21:59:59.999Z');
    // An entry shown as 2026-09-25 00:30 in Berlin is inside that day.
    const entry = new Date('2026-09-24T22:30:00.000Z');
    expect(formatTimestamp(entry, 'Europe/Berlin')).toBe('2026-09-25 00:30');
    expect(entry >= bounds.start && entry <= bounds.end).toBe(true);
    const kolkata = zonedDayBounds('2026-09-25', 'Asia/Kolkata')!;
    expect(kolkata.start.toISOString()).toBe('2026-09-24T18:30:00.000Z');
  });

  it('handles days that are 23 or 25 hours long, and a skipped local midnight', () => {
    const spring = zonedDayBounds('2026-03-29', 'Europe/Berlin')!;
    expect(spring.end.getTime() + 1 - spring.start.getTime()).toBe(23 * 3_600_000);
    const autumn = zonedDayBounds('2026-10-25', 'Europe/Berlin')!;
    expect(autumn.end.getTime() + 1 - autumn.start.getTime()).toBe(25 * 3_600_000);
    // Santiago skips 00:00 → 01:00 when DST starts: the day begins at 01:00 local.
    const skipped = zonedDayBounds('2026-09-06', 'America/Santiago')!;
    expect(formatTimestamp(skipped.start, 'America/Santiago')).toBe('2026-09-06 01:00');
    expect(formatTimestamp(new Date(skipped.start.getTime() - 1), 'America/Santiago')).toBe(
      '2026-09-05 23:59',
    );
  });

  it('BREAK: rejects anything that is not a real calendar day', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-25', '0999-01-01', 'today', '']) {
      expect(zonedDayBounds(bad, 'UTC'), bad).toBeNull();
    }
    expect(zonedDayBounds('2026-09-25', 'Not/AZone')).toEqual(zonedDayBounds('2026-09-25', 'UTC'));
  });
});

describe('audit filters', () => {
  it('applies every valid filter', () => {
    const filters = parseAuditFilters(
      {
        action: 'role.*',
        result: 'success',
        targetType: 'member',
        targetId: 'abc',
        actor: ACTOR_ID,
        since: '2026-09-01',
        until: '2026-09-25',
      },
      'UTC',
    );
    expect(filters.rejected).toEqual([]);
    expect(filters.query).toEqual({
      action: 'role.*',
      result: 'success',
      targetType: 'member',
      targetId: 'abc',
      actorUserId: ACTOR_ID,
      since: new Date('2026-09-01T00:00:00.000Z'),
      until: new Date('2026-09-25T23:59:59.999Z'),
    });
    expect(Object.keys(filters.applied)).toHaveLength(7);
    expect(describeRejectedFilters(filters)).toBeNull();
  });

  it('BREAK: one invalid filter is dropped alone; the others still apply', () => {
    const filters = parseAuditFilters({ action: 'role.*', actor: 'abc' }, 'UTC');
    expect(filters.query).toEqual({ action: 'role.*' });
    expect(filters.applied).toEqual({ action: 'role.*' });
    expect(filters.rejected).toEqual(['actor']);
    expect(describeRejectedFilters(filters)).toBe(
      'The actor filter is not valid and was not applied. The other filters still apply.',
    );
  });

  it('BREAK: says so plainly when no filter could be applied', () => {
    const filters = parseAuditFilters(
      { result: 'maybe', since: '2026-02-30', until: 'soon', targetId: 'x'.repeat(65) },
      'UTC',
    );
    expect(filters.query).toEqual({});
    expect(filters.rejected).toEqual(['result', 'targetId', 'since', 'until']);
    expect(describeRejectedFilters(filters)).toBe(
      'The result, target ID, from date and to date filters are not valid and were not applied. Showing all entries.',
    );
  });

  it('reads dates as days in the viewer time zone', () => {
    const filters = parseAuditFilters(
      { since: '2026-09-25', until: '2026-09-25' },
      'Europe/Berlin',
    );
    expect(filters.query.since).toEqual(new Date('2026-09-24T22:00:00.000Z'));
    expect(filters.query.until).toEqual(new Date('2026-09-25T21:59:59.999Z'));
  });

  it('ignores empty and whitespace-only values', () => {
    const filters = parseAuditFilters({ action: '   ', result: '' }, 'UTC');
    expect(filters).toEqual({ query: {}, applied: {}, rejected: [] });
  });
});
