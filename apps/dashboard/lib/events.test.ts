import { describe, expect, it } from 'vitest';
import { hasIssuedCode } from './check-in-code-state';
import { EventFormError, readEventForm, scheduleInput, updateInput } from './event-form';
import { capacityLabel, locationDisplay } from './event-labels';
import { knownTimeZone, parseDateTimeLocal, toDateTimeLocal } from './zoned-time';

const COUNTS = { going: 12, maybe: 3, declined: 1, waitlist: 0, checkedIn: 0 };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('zoned time', () => {
  it('reads a datetime-local value in the viewer time zone', () => {
    expect(parseDateTimeLocal('2026-10-02T18:00', 'Europe/Amsterdam')?.toISOString()).toBe(
      '2026-10-02T16:00:00.000Z',
    );
    expect(parseDateTimeLocal('2026-10-02T18:00', 'UTC')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
    expect(parseDateTimeLocal('2026-10-02T18:00:30', 'UTC')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
  });

  it('resolves DST edges deterministically', () => {
    // 02:30 does not exist on 2026-03-29 in Amsterdam (clocks jump 02:00 → 03:00).
    expect(parseDateTimeLocal('2026-03-29T02:30', 'Europe/Amsterdam')?.toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    // 02:30 happens twice on 2026-10-25: the later occurrence is chosen.
    expect(parseDateTimeLocal('2026-10-25T02:30', 'Europe/Amsterdam')?.toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });

  it('BREAK: rejects malformed and impossible input; unknown zones fall back to UTC', () => {
    for (const value of [
      '',
      'tomorrow',
      '2026-02-30T10:00',
      '2026-13-01T10:00',
      '2026-10-02 25:00',
    ]) {
      expect(parseDateTimeLocal(value, 'UTC'), value).toBeNull();
    }
    expect(knownTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    expect(parseDateTimeLocal('2026-10-02T18:00', 'Mars/Olympus_Mons')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
  });

  it('round-trips an instant through the form value', () => {
    const instant = new Date('2026-10-02T16:00:00.000Z');
    const value = toDateTimeLocal(instant, 'Europe/Amsterdam');
    expect(value).toBe('2026-10-02T18:00');
    expect(parseDateTimeLocal(value, 'Europe/Amsterdam')?.getTime()).toBe(instant.getTime());
  });
});

describe('event form', () => {
  const base = { title: 'Build Night', kind: 'workshop', startsAt: '2026-10-02T18:00' };

  it('reads the form in the viewer zone and leaves blanks to core', () => {
    const values = readEventForm(form({ ...base, capacity: '', location: '' }), 'UTC');
    expect(values).toMatchObject({
      title: 'Build Night',
      kind: 'workshop',
      capacity: undefined,
      location: undefined,
      endsAt: undefined,
    });
    expect(scheduleInput(values).startsAt.toISOString()).toBe('2026-10-02T18:00:00.000Z');
  });

  it('an edit clears blank optional fields but keeps the duration when the end is blank', () => {
    const values = readEventForm(form({ ...base, description: '', capacity: '' }), 'UTC');
    expect(updateInput('e1', values)).toMatchObject({
      eventId: 'e1',
      description: null,
      location: null,
      capacity: null,
      rsvpClosesAt: null,
      endsAt: undefined,
    });
  });

  it('BREAK: refuses forged kinds, non-numeric capacity and unreadable times by field', () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...base, kind: 'rave' }, 'kind'],
      [{ ...base, capacity: '12.5' }, 'capacity'],
      [{ ...base, capacity: '-3' }, 'capacity'],
      [{ ...base, capacity: '1e3' }, 'capacity'],
      [{ ...base, startsAt: 'next friday' }, 'startsAt'],
      [{ ...base, startsAt: '' }, 'startsAt'],
      [{ ...base, endsAt: '2026-10-02' }, 'endsAt'],
    ];
    for (const [fields, field] of cases) {
      const attempt = () => readEventForm(form(fields), 'UTC');
      expect(attempt, field).toThrow(EventFormError);
      try {
        attempt();
      } catch (error) {
        expect((error as EventFormError).field).toBe(field);
      }
    }
  });
});

describe('event labels', () => {
  it('describes capacity without a global score', () => {
    expect(capacityLabel({ capacity: null, counts: COUNTS })).toBe('12 going · no limit');
    expect(capacityLabel({ capacity: 40, counts: COUNTS })).toBe('12 / 40 going · 28 left');
    expect(capacityLabel({ capacity: 12, counts: COUNTS })).toBe('12 / 12 going · full');
  });

  it('BREAK: only http(s) locations become links', () => {
    expect(locationDisplay({ kind: 'url', value: 'https://example.org/room?x=1' })).toEqual({
      text: 'example.org',
      href: 'https://example.org/room?x=1',
      channel: false,
    });
    expect(locationDisplay({ kind: 'url', value: 'javascript:alert(1)' }).href).toBeNull();
    expect(locationDisplay({ kind: 'text', value: 'Lab 3' })).toEqual({
      text: 'Lab 3',
      href: null,
      channel: false,
    });
    expect(locationDisplay({ kind: 'channel', value: '123456789012345678' }).channel).toBe(true);
    expect(locationDisplay(null).text).toBe('—');
  });

  it('only a successful issue carries a code', () => {
    expect(hasIssuedCode({ status: 'idle' })).toBe(false);
    expect(hasIssuedCode({ status: 'success', message: 'ok', at: 1 })).toBe(false);
    expect(
      hasIssuedCode({
        status: 'success',
        message: 'ok',
        at: 1,
        code: 'ABCD-EFGH',
        opensAt: '2026-10-02 17:30',
        closesAt: '2026-10-02 20:00',
      }),
    ).toBe(true);
  });
});
