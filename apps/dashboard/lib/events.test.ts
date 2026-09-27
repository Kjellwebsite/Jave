import { describe, expect, it } from 'vitest';
import { hasIssuedCode } from './check-in-code-state';
import { EventFormError, readEventForm, scheduleInput, updateInput } from './event-form';
import { capacityLabel, locationDisplay } from './event-labels';

const COUNTS = { going: 12, maybe: 3, declined: 1, waitlist: 0, checkedIn: 0 };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('event form', () => {
  const base = { title: 'Build Night', kind: 'workshop', startsAt: '2026-10-02T18:00' };

  it('reads times in the viewer zone', () => {
    const values = readEventForm(
      form({ ...base, endsAt: '2026-10-02T21:30', rsvpClosesAt: '2026-10-01T12:00' }),
      'Europe/Amsterdam',
    );
    expect(values.startsAt.toISOString()).toBe('2026-10-02T16:00:00.000Z');
    expect(values.endsAt?.toISOString()).toBe('2026-10-02T19:30:00.000Z');
    expect(values.rsvpClosesAt?.toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

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
