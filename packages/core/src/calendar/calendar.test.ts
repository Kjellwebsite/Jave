import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, events, jobs, members, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import {
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import { CALENDAR_REMINDER_JOB } from './constants';
import { DISCORD_EVENTS_CANCEL_JOB, DISCORD_EVENTS_PUBLISH_JOB } from './discord-jobs';
import {
  cancelEvent,
  completeEvent,
  getEvent,
  listEvents,
  markEventLive,
  scheduleEvent,
  updateEvent,
} from './events.service';
import { generateCheckInCode } from './check-in.service';
import { listMemberEventHistory, listParticipants, rsvp } from './rsvp.service';
import { sweepStaleEvents } from './jobs';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from './test-support';

/** Scheduling, editing, lifecycle, RSVPs and listings. */
describe('calendar', () => {
  let kit: TestKit;
  let staff: UserActor;

  beforeAll(warmUpTestDatabase, SNAPSHOT_BUILD_TIMEOUT_MS);
  beforeEach(async () => {
    kit = await createTestKit({ publicUrl: 'https://jave.example' });
    staff = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  const fromNow = (ms: number) => new Date(kit.clock.now().getTime() + ms);
  const schedule = (overrides: Partial<Parameters<typeof scheduleEvent>[1]> = {}) =>
    scheduleEvent(kit.as(staff), {
      title: 'Build Night',
      kind: 'meetup',
      startsAt: fromNow(2 * DAY),
      ...overrides,
    });
  const jobsOf = (type: string) => kit.db.select().from(jobs).where(eq(jobs.type, type));
  const notificationsOf = (type: string) =>
    kit.db.select().from(notifications).where(eq(notifications.type, type));
  const eventsOf = (type: string) =>
    kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));

  describe('scheduling', () => {
    it('schedules an event with Discord mirror, reminders, audit and domain event', async () => {
      const event = await schedule({ capacity: 20, location: 'https://meet.example.com/x' });
      expect(event.status).toBe('scheduled');
      expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(2 * HOUR);
      expect(event.location).toEqual({ kind: 'url', value: 'https://meet.example.com/x' });
      expect(event.spotsLeft).toBe(20);
      expect(event.hostMemberId).toBe(staff.memberId);

      const publish = await jobsOf(DISCORD_EVENTS_PUBLISH_JOB);
      expect(publish).toHaveLength(1);
      expect(publish[0]!.payload).toEqual({ eventId: event.id, revision: 0 });

      const reminders = await jobsOf(CALENDAR_REMINDER_JOB);
      expect(reminders.map((j) => j.runAt.getTime()).sort()).toEqual([
        event.startsAt.getTime() - DAY,
        event.startsAt.getTime() - HOUR,
      ]);
      expect(await eventsOf('event.created')).toHaveLength(1);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'event.scheduled'));
      expect(audit!.actorUserId).toBe(staff.userId);
    });

    it('skips reminders that would already be in the past', async () => {
      await schedule({ startsAt: fromNow(3 * HOUR) });
      const reminders = await jobsOf(CALENDAR_REMINDER_JOB);
      expect(reminders.map((j) => j.payload.reminder)).toEqual(['1h']);
    });

    it('BREAK: members cannot schedule events, and the denial is audited', async () => {
      const member = await kit.member({ roles: ['verified'] });
      await expect(
        scheduleEvent(kit.as(member), { title: 'Mine', kind: 'social', startsAt: fromNow(DAY) }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const denied = await kit.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, member.userId)),
        );
      expect(denied).toHaveLength(1);
      await expect(
        scheduleEvent(kit.as(anonymousActor), {
          title: 'Mine',
          kind: 'social',
          startsAt: fromNow(DAY),
        }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('BREAK: rejects malformed, oversized and hostile input', async () => {
      const bad: Partial<Parameters<typeof scheduleEvent>[1]>[] = [
        { startsAt: fromNow(-MINUTE) },
        { title: 'x'.repeat(101) },
        { title: 'Two\nlines' },
        { description: 'y'.repeat(1001) },
        { location: 'javascript:alert(1)' },
        { location: 'data:text/html,<script>alert(1)</script>' },
        { capacity: 0 },
        { capacity: 10_001 },
        { endsAt: fromNow(DAY) },
        { rsvpClosesAt: fromNow(3 * DAY) },
        { kind: 'rave' as 'social' },
        { hostMemberId: 'not-a-uuid' },
      ];
      for (const overrides of bad) {
        await expect(schedule(overrides), JSON.stringify(overrides)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }
      await expect(
        schedule({ hostMemberId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await kit.db.select().from(events)).toHaveLength(0);
    });

    it('never exposes the check-in hash through views', async () => {
      const event = await schedule();
      await generateCheckInCode(kit.as(staff), { eventId: event.id });
      const view = await getEvent(kit.as(await kit.member()), { eventId: event.id });
      expect(view.checkInCodeIssued).toBe(true);
      expect(JSON.stringify(view)).not.toMatch(/hash/i);
    });
  });

  describe('updating and cancelling', () => {
    it('reschedule moves reminders (old dedupe keys cancelled) and notifies respondents', async () => {
      const event = await schedule();
      const member = await kit.member();
      await rsvp(kit.as(member), { eventId: event.id, status: 'going' });
      const newStart = fromNow(3 * DAY);
      const updated = await updateEvent(kit.as(staff), { eventId: event.id, startsAt: newStart });
      expect(updated.startsAt).toEqual(newStart);
      expect(updated.endsAt.getTime() - updated.startsAt.getTime()).toBe(2 * HOUR);

      const reminders = await jobsOf(CALENDAR_REMINDER_JOB);
      const cancelled = reminders.filter((j) => j.status === 'cancelled');
      const pending = reminders.filter((j) => j.status === 'pending');
      expect(cancelled).toHaveLength(2);
      expect(pending.map((j) => j.runAt.getTime()).sort()).toEqual([
        newStart.getTime() - DAY,
        newStart.getTime() - HOUR,
      ]);
      const [notice] = await notificationsOf('event.updated');
      expect(notice!.title).toBe('EVENT RESCHEDULED');
      expect(notice!.recipientUserId).toBe(member.userId);
      expect(notice!.url).toBe(`https://jave.example/events/${event.id}`);

      const publishes = await jobsOf(DISCORD_EVENTS_PUBLISH_JOB);
      const byRevision = publishes.filter((j) => !j.dedupeKey!.endsWith(':counts'));
      expect(byRevision.map((j) => j.payload.revision)).toEqual([0, 1]);
      // The RSVP queued one debounced announcement refresh.
      const refreshes = publishes.filter((j) => j.dedupeKey!.endsWith(':counts'));
      expect(refreshes).toHaveLength(1);
      expect(refreshes[0]!.runAt.getTime()).toBeGreaterThan(refreshes[0]!.createdAt.getTime());
    });

    it('no-op updates change nothing', async () => {
      const event = await schedule();
      await updateEvent(kit.as(staff), { eventId: event.id, title: 'Build Night' });
      expect(await eventsOf('event.updated')).toHaveLength(0);
      await expect(updateEvent(kit.as(staff), { eventId: event.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('cancel notifies going, maybe and waitlisted members and enqueues Discord cleanup', async () => {
      const event = await schedule({ capacity: 1 });
      const [a, b, c, d] = await Promise.all([
        kit.member(),
        kit.member(),
        kit.member(),
        kit.member(),
      ]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(b!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(c!), { eventId: event.id, status: 'maybe' });
      await rsvp(kit.as(d!), { eventId: event.id, status: 'declined' });
      const cancelled = await cancelEvent(kit.as(staff), {
        eventId: event.id,
        reason: 'Venue unavailable.',
      });
      expect(cancelled.status).toBe('cancelled');
      const notices = await notificationsOf('event.updated');
      expect(notices.map((n) => n.recipientUserId).sort()).toEqual(
        [a!.userId, b!.userId, c!.userId].sort(),
      );
      expect(notices[0]!.body).toContain('Venue unavailable.');
      expect(await jobsOf(DISCORD_EVENTS_CANCEL_JOB)).toHaveLength(1);
      const reminders = await jobsOf(CALENDAR_REMINDER_JOB);
      expect(reminders.every((j) => j.status === 'cancelled')).toBe(true);

      await expect(
        cancelEvent(kit.as(staff), { eventId: event.id, reason: 'again' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(rsvp(kit.as(a!), { eventId: event.id, status: 'going' })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(
        updateEvent(kit.as(staff), { eventId: event.id, title: 'Revived' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('goes live no earlier than 30 minutes before the start, then completes', async () => {
      const event = await schedule({ startsAt: fromNow(2 * HOUR) });
      await expect(markEventLive(kit.as(staff), { eventId: event.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(completeEvent(kit.as(staff), { eventId: event.id })).rejects.toThrow(
        /not started/,
      );
      kit.clock.advance(90 * MINUTE);
      const live = await markEventLive(kit.as(staff), { eventId: event.id });
      expect(live.status).toBe('live');
      expect(await eventsOf('event.started')).toHaveLength(1);
      const done = await completeEvent(kit.as(staff), { eventId: event.id });
      expect(done.status).toBe('completed');
      const [completed] = await eventsOf('event.completed');
      expect(completed!.payload).toMatchObject({ source: 'manual' });
      await expect(markEventLive(kit.as(staff), { eventId: event.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });

    it('the sweep completes events long past their end', async () => {
      const event = await schedule({ startsAt: fromNow(HOUR) });
      kit.clock.advance(3 * HOUR);
      expect(await sweepStaleEvents(kit.system)).toBe(0);
      kit.clock.advance(12 * HOUR);
      expect(await sweepStaleEvents(kit.system)).toBe(0);
      kit.clock.advance(1);
      expect(await sweepStaleEvents(kit.system)).toBe(1);
      expect((await getEvent(kit.system, { eventId: event.id })).status).toBe('completed');
      const [completed] = await eventsOf('event.completed');
      expect(completed!.payload).toMatchObject({ source: 'sweep' });
    });
  });

  describe('RSVP, capacity and waitlist', () => {
    it('fills to capacity, waitlists FIFO, and promotes when a going member declines', async () => {
      const event = await schedule({ capacity: 2 });
      const people = await Promise.all([1, 2, 3, 4].map(() => kit.member()));
      const results = [];
      for (const person of people) {
        results.push(await rsvp(kit.as(person), { eventId: event.id, status: 'going' }));
        kit.clock.advance(1000);
      }
      expect(results.map((r) => r.status)).toEqual(['going', 'going', 'waitlist', 'waitlist']);
      expect(results.map((r) => r.waitlistPosition)).toEqual([null, null, 1, 2]);

      const change = await rsvp(kit.as(people[0]!), { eventId: event.id, status: 'declined' });
      expect(change).toMatchObject({ status: 'declined', changed: true });
      const view = await getEvent(kit.as(people[2]!), { eventId: event.id });
      expect(view.myRsvp?.status).toBe('going');
      expect(view.counts).toMatchObject({ going: 2, waitlist: 1, declined: 1 });
      const [promoted] = await notificationsOf('event.waitlist');
      expect(promoted!.recipientUserId).toBe(people[2]!.userId);
      expect(promoted!.title).toBe('SPOT CONFIRMED');
      const fourth = await getEvent(kit.as(people[3]!), { eventId: event.id });
      expect(fourth.myRsvp?.waitlistPosition).toBe(1);

      const rsvpEvents = await eventsOf('event.rsvp');
      const promotedEvent = rsvpEvents.find((e) => e.payload.promoted === true);
      expect(promotedEvent?.subjectMemberId).toBe(people[2]!.memberId);
    });

    it('re-sending the same response is idempotent and keeps the waitlist place', async () => {
      const event = await schedule({ capacity: 1 });
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(b!), { eventId: event.id, status: 'going' });
      const again = await rsvp(kit.as(b!), { eventId: event.id, status: 'going' });
      expect(again).toMatchObject({ status: 'waitlist', changed: false, waitlistPosition: 1 });
      expect(await eventsOf('event.rsvp')).toHaveLength(2);
    });

    it('raising capacity promotes from the waitlist; lowering it removes no one', async () => {
      const event = await schedule({ capacity: 1 });
      const [a, b, c] = await Promise.all([kit.member(), kit.member(), kit.member()]);
      for (const person of [a!, b!, c!]) {
        await rsvp(kit.as(person), { eventId: event.id, status: 'going' });
        kit.clock.advance(1000);
      }
      await updateEvent(kit.as(staff), { eventId: event.id, capacity: 2 });
      let view = await getEvent(kit.as(b!), { eventId: event.id });
      expect(view.myRsvp?.status).toBe('going');
      await updateEvent(kit.as(staff), { eventId: event.id, capacity: 1 });
      view = await getEvent(kit.as(b!), { eventId: event.id });
      expect(view.counts.going).toBe(2);
      expect(view.spotsLeft).toBe(0);
      await updateEvent(kit.as(staff), { eventId: event.id, capacity: null });
      view = await getEvent(kit.as(c!), { eventId: event.id });
      expect(view.myRsvp?.status).toBe('going');
    });

    it('BREAK: concurrent RSVPs never exceed capacity', async () => {
      const event = await schedule({ capacity: 3 });
      const people = await Promise.all(Array.from({ length: 8 }, () => kit.member()));
      const results = await Promise.all(
        people.map((p) => rsvp(kit.as(p), { eventId: event.id, status: 'going' })),
      );
      expect(results.filter((r) => r.status === 'going')).toHaveLength(3);
      expect(results.filter((r) => r.status === 'waitlist')).toHaveLength(5);
      const view = await getEvent(kit.system, { eventId: event.id });
      expect(view.counts.going).toBe(3);
      // Eight RSVPs, one debounced announcement refresh.
      const refreshes = (await jobsOf(DISCORD_EVENTS_PUBLISH_JOB)).filter((j) =>
        j.dedupeKey!.endsWith(':counts'),
      );
      expect(refreshes).toHaveLength(1);
    });

    it('BREAK: RSVP flipping is rate limited per member', async () => {
      const event = await schedule();
      const member = await kit.member();
      for (let i = 0; i < 20; i++) {
        await rsvp(kit.as(member), { eventId: event.id, status: i % 2 ? 'maybe' : 'going' });
      }
      await expect(
        rsvp(kit.as(member), { eventId: event.id, status: 'declined' }),
      ).rejects.toBeInstanceOf(RateLimitedError);
      kit.clock.advance(61_000);
      await expect(
        rsvp(kit.as(member), { eventId: event.id, status: 'declined' }),
      ).resolves.toMatchObject({ status: 'declined' });
    });

    it('closes RSVPs at rsvpClosesAt but still lets members decline', async () => {
      const event = await schedule({ rsvpClosesAt: fromNow(DAY) });
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      kit.clock.advance(DAY);
      await expect(rsvp(kit.as(b!), { eventId: event.id, status: 'going' })).rejects.toThrow(
        /closed/,
      );
      await expect(
        rsvp(kit.as(a!), { eventId: event.id, status: 'declined' }),
      ).resolves.toMatchObject({ status: 'declined' });
    });

    it('BREAK: restricted and quarantined members cannot RSVP; unknown events are not found', async () => {
      const event = await schedule();
      const member = await kit.member();
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, member.memberId!));
      const restricted = await resolveUserActor(kit.system, member.userId);
      await expect(
        rsvp(kit.as(restricted), { eventId: event.id, status: 'going' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        rsvp(kit.as(anonymousActor), { eventId: event.id, status: 'going' }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      const ok = await kit.member();
      await expect(
        rsvp(kit.as(ok), { eventId: '00000000-0000-4000-8000-000000000000', status: 'going' }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        rsvp(kit.as(ok), { eventId: event.id, status: 'waitlist' as 'going' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('participant lists are staff-only; history is self or staff (no IDOR)', async () => {
      const event = await schedule();
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      await expect(listParticipants(kit.as(a!), { eventId: event.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const list = await listParticipants(kit.as(staff), { eventId: event.id });
      expect(list.items.map((p) => p.memberId)).toEqual([a!.memberId]);

      const mine = await listMemberEventHistory(kit.as(a!), { memberId: a!.memberId! });
      expect(mine.items).toHaveLength(1);
      expect(mine.items[0]).toMatchObject({ eventId: event.id, rsvpStatus: 'going' });
      await expect(
        listMemberEventHistory(kit.as(b!), { memberId: a!.memberId! }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const asStaff = await listMemberEventHistory(kit.as(staff), { memberId: a!.memberId! });
      expect(asStaff.total).toBe(1);
    });

    it('lists upcoming and past events with the viewer’s RSVP', async () => {
      const soon = await schedule({ title: 'Soon', startsAt: fromNow(HOUR) });
      const later = await schedule({ title: 'Later', startsAt: fromNow(3 * DAY), kind: 'talk' });
      const gone = await schedule({ title: 'Gone', startsAt: fromNow(2 * HOUR) });
      await cancelEvent(kit.as(staff), { eventId: gone.id, reason: 'Speaker ill.' });
      const member = await kit.member();
      await rsvp(kit.as(member), { eventId: later.id, status: 'maybe' });

      const upcoming = await listEvents(kit.as(member), { scope: 'upcoming' });
      expect(upcoming.items.map((e) => e.title)).toEqual(['Soon', 'Later']);
      expect(upcoming.items[1]!.myRsvp?.status).toBe('maybe');
      const talks = await listEvents(kit.as(member), { scope: 'upcoming', kind: 'talk' });
      expect(talks.items.map((e) => e.id)).toEqual([later.id]);
      const past = await listEvents(kit.as(member), { scope: 'past' });
      expect(past.items.map((e) => e.title)).toEqual(['Gone']);
      kit.clock.advance(4 * HOUR);
      const pastLater = await listEvents(kit.as(member), { scope: 'past' });
      expect(pastLater.items.map((e) => e.id)).toContain(soon.id);
      await expect(listEvents(kit.as(anonymousActor))).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
