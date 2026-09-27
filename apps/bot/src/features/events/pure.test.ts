import { describe, expect, it } from 'vitest';
import { type calendar } from '@jave/core';
import { KeyedLock } from '../../discord/keyed-lock';
import { planScheduledEventUpdate } from '../../discord/scheduled-event-status';
import { bracketBlock, codeSafe } from './render-tournament';
import { announcementMessage, capacityValue, whereValue } from './render-event';
import { scheduledEventSpec } from './sync-jobs';
import { parseStartInput, wallTimeToInstant } from './time-input';

describe('start time input', () => {
  it('reads local wall time in the member time zone', () => {
    expect(parseStartInput('2026-10-02 18:00', 'UTC')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
    expect(parseStartInput('2026-10-02 18:00', 'Europe/Berlin')?.toISOString()).toBe(
      '2026-10-02T16:00:00.000Z',
    );
    expect(parseStartInput('2026-01-15T09:30', 'America/New_York')?.toISOString()).toBe(
      '2026-01-15T14:30:00.000Z',
    );
  });

  it('accepts ISO 8601 with an offset and Discord timestamps', () => {
    expect(parseStartInput('2026-10-02T18:00:00+02:00', 'UTC')?.toISOString()).toBe(
      '2026-10-02T16:00:00.000Z',
    );
    expect(parseStartInput('2026-10-02T18:00Z', 'Asia/Tokyo')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
    expect(parseStartInput('<t:1790000000:F>', 'UTC')?.getTime()).toBe(1_790_000_000_000);
  });

  it('handles daylight-saving transitions deterministically', () => {
    // Europe/Berlin springs forward at 02:00 on 2026-03-29: 02:30 does not exist.
    expect(
      wallTimeToInstant(
        { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
        'Europe/Berlin',
      ).toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
    // 01:30 on 2026-10-25 is still summer time; 02:30 happens twice (the later one wins).
    expect(
      wallTimeToInstant(
        { year: 2026, month: 10, day: 25, hour: 1, minute: 30 },
        'Europe/Berlin',
      ).toISOString(),
    ).toBe('2026-10-24T23:30:00.000Z');
    expect(
      wallTimeToInstant(
        { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
        'Europe/Berlin',
      ).toISOString(),
    ).toBe('2026-10-25T01:30:00.000Z');
  });

  it('BREAK: rejects malformed, impossible and oversized input', () => {
    for (const input of [
      '',
      'tomorrow at six',
      '2026-02-30 10:00',
      '2026-13-01 10:00',
      '2026-10-02 24:00',
      '2026-10-02T18:00+25:99',
      '<t:abc>',
      `2026-10-02 18:00${' '.repeat(50)}x`,
      '2026-10-02 18:00; drop table events',
    ]) {
      expect(parseStartInput(input, 'UTC'), input).toBeNull();
    }
    // An unknown time zone falls back to UTC instead of throwing.
    expect(parseStartInput('2026-10-02 18:00', 'Mars/Olympus')?.toISOString()).toBe(
      '2026-10-02T18:00:00.000Z',
    );
  });
});

describe('scheduled event status plan', () => {
  it('reaches every target through transitions Discord allows', () => {
    expect(planScheduledEventUpdate('scheduled', 'completed').transitions).toEqual([
      'active',
      'completed',
    ]);
    expect(planScheduledEventUpdate('scheduled', 'active')).toMatchObject({
      editable: true,
      startEditable: true,
      transitions: ['active'],
    });
    expect(planScheduledEventUpdate('active', 'active')).toMatchObject({
      editable: true,
      startEditable: false,
      transitions: [],
    });
    expect(planScheduledEventUpdate('active', 'canceled')).toMatchObject({ remove: true });
    expect(planScheduledEventUpdate('active', 'scheduled').transitions).toEqual([]);
    for (const final of ['completed', 'canceled'] as const) {
      expect(planScheduledEventUpdate(final, 'active')).toEqual({
        editable: false,
        startEditable: false,
        transitions: [],
        remove: false,
      });
    }
  });
});

describe('KeyedLock', () => {
  it('serializes work per key and releases keys afterwards', async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lock.run('event-a', async () => {
      order.push('a1 start');
      await gate;
      order.push('a1 end');
    });
    const second = lock.run('event-a', async () => {
      order.push('a2');
    });
    const other = lock.run('event-b', async () => {
      order.push('b');
    });
    await other;
    expect(order).toEqual(['a1 start', 'b']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a1 start', 'b', 'a1 end', 'a2']);
    expect(lock.size).toBe(0);
  });

  it('releases the key when the work throws', async () => {
    const lock = new KeyedLock();
    await expect(lock.run('x', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock.run('x', async () => 'next')).resolves.toBe('next');
  });
});

const publication = (
  overrides: Partial<calendar.EventPublication> = {},
): calendar.EventPublication => ({
  eventId: '11111111-1111-4111-8111-111111111111',
  revision: 3,
  title: 'Build Night',
  description: 'Bring hardware.',
  kind: 'meetup',
  status: 'scheduled',
  startsAt: new Date('2026-03-05T18:00:00Z'),
  endsAt: new Date('2026-03-05T20:00:00Z'),
  location: null,
  capacity: 20,
  counts: { going: 5, maybe: 1, declined: 0, waitlist: 0, checkedIn: 0 },
  rsvpOpen: true,
  declineOpen: true,
  cancelReason: null,
  discordScheduledEventId: null,
  announcementChannelId: null,
  announcementMessageId: null,
  announceChannelId: '600000000000000001',
  ...overrides,
});

describe('event rendering', () => {
  it('maps locations to scheduled-event entities', () => {
    expect(scheduledEventSpec(publication())).toMatchObject({ location: 'JAVELIN' });
    expect(
      scheduledEventSpec(
        publication({ location: { kind: 'channel', value: '700000000000000001' } }),
      ),
    ).toMatchObject({ channelId: '700000000000000001' });
    expect(
      scheduledEventSpec(publication({ location: { kind: 'text', value: 'Lab 3, Berlin' } })),
    ).toMatchObject({ location: 'Lab 3, Berlin' });
  });

  it('renders locations safely', () => {
    expect(whereValue({ kind: 'channel', value: '700000000000000001' })).toBe(
      '<#700000000000000001>',
    );
    expect(whereValue({ kind: 'url', value: 'https://meet.example.org/a_(b)' })).toBe(
      '[meet.example.org](https://meet.example.org/a_%28b%29)',
    );
    expect(whereValue({ kind: 'url', value: 'javascript:alert(1)' })).toBe('—');
    // Markdown in a hostname cannot style or break the link label.
    expect(whereValue({ kind: 'url', value: 'https://a*b_c.example.org/' })).toBe(
      '[a\\*b\\_c.example.org](https://a*b_c.example.org/)',
    );
    expect(whereValue({ kind: 'text', value: '@everyone *Lab*' })).not.toContain('@everyone');
  });

  it('shows capacity, spots left and the waitlist', () => {
    expect(capacityValue({ capacity: null, counts: publication().counts })).toContain('no limit');
    expect(capacityValue({ capacity: 20, counts: publication().counts })).toContain(
      '15 spots left',
    );
    expect(
      capacityValue({
        capacity: 5,
        counts: { going: 5, maybe: 0, declined: 0, waitlist: 2, checkedIn: 0 },
      }),
    ).toBe('5 / 5 going · FULL · waitlist open · 2 waitlisted');
  });

  it('disables RSVP buttons by the publication flags', () => {
    const closed = announcementMessage(publication({ rsvpOpen: false, declineOpen: true }));
    const buttons = closed.components![0]!.components as {
      custom_id?: string;
      disabled?: boolean;
    }[];
    expect(buttons.map((b) => [b.custom_id, b.disabled])).toEqual([
      ['events:rsvp:11111111-1111-4111-8111-111111111111:going', true],
      ['events:rsvp:11111111-1111-4111-8111-111111111111:maybe', true],
      ['events:rsvp:11111111-1111-4111-8111-111111111111:declined', false],
      ['events:view:11111111-1111-4111-8111-111111111111', false],
    ]);
  });

  it('BREAK: user text cannot break out of the bracket code block', () => {
    expect(codeSafe('```@everyone\u0007')).toBe("'''@everyone ");
    const team = (id: string, name: string, seed: number) => ({ id, name, seed });
    const block = bracketBlock({
      eventId: 'e',
      state: 'in_progress',
      champion: null,
      rounds: [
        {
          round: 1,
          name: 'Final',
          matches: [
            {
              id: 'm',
              round: 1,
              position: 0,
              status: 'completed',
              teamA: team('a', '```Alpha```', 1),
              teamB: team('b', 'Beta', 2),
              scoreA: 3,
              scoreB: 1,
              winnerTeamId: 'a',
              nextMatchId: null,
              nextSlot: null,
              completedAt: null,
            },
          ],
        },
      ],
    });
    expect(block.text.match(/```/g)).toHaveLength(2);
    expect(block.text).toContain('◀');
  });
});
