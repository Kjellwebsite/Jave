import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { calendar, DAY, HOUR, MINUTE, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { domainEvents, notifications } from '@jave/database';
import {
  EVENT_TIME_FIELDS,
  editFormDefaults,
  initialFieldName,
  readEventForm,
  untouchedTimeFields,
  updateInput,
} from './event-form';
import { toDatetimeLocal } from './datetime-local';

const TIME_ZONE = 'Europe/Amsterdam';
const SECOND = 1000;

/**
 * The Edit tab end to end through core: the form exactly as the page renders
 * it (pre-filled values plus their hidden twins), edited like a person would.
 */
describe('editing an event through the dashboard form', () => {
  let kit: TestKit;
  let staff: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    staff = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  const fromNow = (ms: number) => new Date(kit.clock.now().getTime() + ms);

  async function editTab(eventId: string): Promise<FormData> {
    const event = await calendar.getEvent(kit.as(staff), { eventId });
    const defaults = editFormDefaults(event, TIME_ZONE);
    const data = new FormData();
    data.set('eventId', eventId);
    for (const [name, value] of Object.entries(defaults)) data.set(name, value);
    for (const field of EVENT_TIME_FIELDS) data.set(initialFieldName(field), defaults[field]);
    return data;
  }

  const save = (eventId: string, data: FormData) =>
    calendar.updateEvent(
      kit.as(staff),
      updateInput(eventId, readEventForm(data, TIME_ZONE), untouchedTimeFields(data)),
    );

  const rescheduleNotices = () =>
    kit.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.type, 'event.updated'), eq(notifications.title, 'EVENT RESCHEDULED')),
      );

  it('fixes the description after the RSVP close has passed; RSVPs stay closed', async () => {
    const closes = fromNow(DAY);
    const event = await calendar.scheduleEvent(kit.as(staff), {
      title: 'Build Night',
      kind: 'meetup',
      startsAt: fromNow(3 * DAY),
      rsvpClosesAt: closes,
    });
    kit.clock.advance(2 * DAY);
    const data = await editTab(event.id);
    data.set('description', 'Bring hardware.');
    const saved = await save(event.id, data);
    expect(saved.description).toBe('Bring hardware.');
    expect(saved.rsvpClosesAt).toEqual(closes);
    expect(saved.rsvpOpen).toBe(false);
  });

  it('BREAK: a save with untouched times keeps a start that carries seconds', async () => {
    const start = new Date(fromNow(3 * DAY).getTime() + 30 * SECOND);
    const event = await calendar.scheduleEvent(kit.as(staff), {
      title: 'Build Night',
      kind: 'meetup',
      startsAt: start,
    });
    const member = await kit.member();
    await calendar.rsvp(kit.as(member), { eventId: event.id, status: 'going' });
    const data = await editTab(event.id);
    data.set('title', 'Build Night II');
    const saved = await save(event.id, data);
    expect(saved.startsAt).toEqual(start);
    expect(saved.endsAt.getTime() - saved.startsAt.getTime()).toBe(2 * HOUR);
    expect(await rescheduleNotices()).toHaveLength(0);
    const [updated] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'event.updated'));
    expect(updated!.payload).toMatchObject({ fields: ['title'], rescheduled: false });
  });

  it('moving the start with the end untouched keeps the duration', async () => {
    const event = await calendar.scheduleEvent(kit.as(staff), {
      title: 'Build Night',
      kind: 'meetup',
      startsAt: fromNow(3 * DAY),
    });
    for (const shift of [DAY, 30 * MINUTE]) {
      const current = await calendar.getEvent(kit.as(staff), { eventId: event.id });
      const data = await editTab(event.id);
      const moved = new Date(current.startsAt.getTime() + shift);
      data.set('startsAt', toDatetimeLocal(moved, TIME_ZONE));
      const saved = await save(event.id, data);
      expect(saved.startsAt).toEqual(moved);
      expect(saved.endsAt.getTime() - saved.startsAt.getTime()).toBe(2 * HOUR);
    }
    expect(await rescheduleNotices()).toHaveLength(0);
  });

  it('a new end, typed by the viewer, still sets the duration', async () => {
    const event = await calendar.scheduleEvent(kit.as(staff), {
      title: 'Build Night',
      kind: 'meetup',
      startsAt: fromNow(3 * DAY),
    });
    const data = await editTab(event.id);
    const end = new Date(event.startsAt.getTime() + 3 * HOUR);
    data.set('endsAt', toDatetimeLocal(end, TIME_ZONE));
    const saved = await save(event.id, data);
    expect(saved.endsAt).toEqual(end);
  });
});
