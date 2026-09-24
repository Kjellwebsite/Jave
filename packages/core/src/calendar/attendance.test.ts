import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, domainEvents, events, jobs, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import {
  ForbiddenError,
  InvalidStateError,
  RateLimitedError,
  ValidationError,
} from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { CALENDAR_REMINDER_JOB } from './constants';
import { DISCORD_EVENTS_CANCEL_JOB, getEventPublication, markEventPublished } from './discord-jobs';
import { cancelEvent, getEvent, scheduleEvent, updateEvent } from './events.service';
import { checkIn, generateCheckInCode } from './check-in.service';
import { rsvp } from './rsvp.service';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from './test-support';
import { jobHandlers } from './index';

/** Check-in, reminders and the Discord callbacks. */
describe('calendar attendance', () => {
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

  describe('check-in', () => {
    async function liveSetup() {
      const event = await schedule({ startsAt: fromNow(HOUR), endsAt: fromNow(3 * HOUR) });
      const issued = await generateCheckInCode(kit.as(staff), { eventId: event.id });
      return { event, code: issued.code };
    }

    it('returns the code once and stores only its SHA-256', async () => {
      const { event, code } = await liveSetup();
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const [row] = await kit.db.select().from(events).where(eq(events.id, event.id));
      expect(row!.checkInCodeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(code.replace('-', ''));
      const audits = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'event.check_in_code_issued'));
      expect(JSON.stringify(audits)).not.toContain(code.replace('-', ''));
    });

    it('checks in inside the window, idempotently, and publishes event.checked_in', async () => {
      const { event, code } = await liveSetup();
      const member = await kit.member();
      kit.clock.advance(30 * MINUTE);
      const first = await checkIn(kit.as(member), { eventId: event.id, code: code.toLowerCase() });
      expect(first.alreadyCheckedIn).toBe(false);
      const second = await checkIn(kit.as(member), { eventId: event.id, code: 'WRONG' });
      expect(second).toMatchObject({ alreadyCheckedIn: true, checkedInAt: first.checkedInAt });
      const [checked] = await eventsOf('event.checked_in');
      expect(checked!.subjectMemberId).toBe(member.memberId);
      const view = await getEvent(kit.as(member), { eventId: event.id });
      expect(view.myRsvp).toMatchObject({ status: 'going' });
      expect(view.counts.checkedIn).toBe(1);
    });

    it('BREAK: rejects check-in outside the window (edges inclusive)', async () => {
      const { event, code } = await liveSetup();
      const member = await kit.member();
      kit.clock.advance(30 * MINUTE - 1);
      await expect(checkIn(kit.as(member), { eventId: event.id, code })).rejects.toThrow(
        /opens 30 minutes/,
      );
      kit.clock.set(event.endsAt);
      await expect(checkIn(kit.as(member), { eventId: event.id, code })).resolves.toMatchObject({
        alreadyCheckedIn: false,
      });
      const late = await kit.member();
      kit.clock.advance(1);
      await expect(checkIn(kit.as(late), { eventId: event.id, code })).rejects.toThrow(/closed/);
    });

    it('BREAK: wrong codes fail, are audited and rate limited; codes are bound to their event', async () => {
      const { event, code } = await liveSetup();
      const other = await schedule({ startsAt: fromNow(HOUR) });
      const otherCode = (await generateCheckInCode(kit.as(staff), { eventId: other.id })).code;
      const member = await kit.member();
      kit.clock.advance(45 * MINUTE);
      await expect(
        checkIn(kit.as(member), { eventId: event.id, code: otherCode }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        checkIn(kit.as(member), { eventId: event.id, code: 'X'.repeat(33) }),
      ).rejects.toBeInstanceOf(ValidationError);
      for (let i = 0; i < 4; i++) {
        await expect(
          checkIn(kit.as(member), { eventId: event.id, code: 'AAAA-AAAA' }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
      await expect(checkIn(kit.as(member), { eventId: event.id, code })).rejects.toBeInstanceOf(
        RateLimitedError,
      );
      const failures = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'event.check_in_failed'));
      expect(failures).toHaveLength(5);
      expect(failures.every((f) => f.result === 'denied')).toBe(true);
      kit.clock.advance(10 * MINUTE + 1000);
      await expect(checkIn(kit.as(member), { eventId: event.id, code })).resolves.toBeTruthy();
    });

    it('BREAK: rotating the code invalidates the old one; no code means no check-in', async () => {
      const event = await schedule({ startsAt: fromNow(HOUR) });
      const member = await kit.member();
      kit.clock.advance(40 * MINUTE);
      await expect(
        checkIn(kit.as(member), { eventId: event.id, code: 'ABCD-EFGH' }),
      ).rejects.toThrow(/not issued a code/);
      const old = await generateCheckInCode(kit.as(staff), { eventId: event.id });
      const fresh = await generateCheckInCode(kit.as(staff), { eventId: event.id });
      await expect(
        checkIn(kit.as(member), { eventId: event.id, code: old.code }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        checkIn(kit.as(member), { eventId: event.id, code: fresh.code }),
      ).resolves.toMatchObject({ alreadyCheckedIn: false });
      await expect(
        generateCheckInCode(kit.as(member), { eventId: event.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('attendance overrides the waitlist and cancelled events refuse check-in', async () => {
      const { event, code } = await liveSetup();
      await updateEvent(kit.as(staff), { eventId: event.id, capacity: 1 });
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(b!), { eventId: event.id, status: 'going' });
      kit.clock.advance(40 * MINUTE);
      await checkIn(kit.as(b!), { eventId: event.id, code });
      expect((await getEvent(kit.as(b!), { eventId: event.id })).myRsvp?.status).toBe('going');
      await cancelEvent(kit.as(staff), { eventId: event.id, reason: 'Fire alarm.' });
      await expect(checkIn(kit.as(a!), { eventId: event.id, code })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });
  });

  describe('reminders', () => {
    it('reminds going members at −24 h and −1 h exactly once each', async () => {
      const event = await schedule({ startsAt: fromNow(2 * DAY) });
      const [going, maybe] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(going!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(maybe!), { eventId: event.id, status: 'maybe' });

      await kit.drain(jobHandlers);
      expect(await notificationsOf('event.reminder')).toHaveLength(0);

      kit.clock.set(new Date(event.startsAt.getTime() - DAY));
      await kit.drain(jobHandlers);
      let reminders = await notificationsOf('event.reminder');
      expect(reminders).toHaveLength(1);
      expect(reminders[0]!).toMatchObject({
        recipientUserId: going!.userId,
        title: 'EVENT IN 24 HOURS',
      });

      await kit.drain(jobHandlers);
      expect(await notificationsOf('event.reminder')).toHaveLength(1);

      kit.clock.set(new Date(event.startsAt.getTime() - HOUR));
      await kit.drain(jobHandlers);
      reminders = await notificationsOf('event.reminder');
      expect(reminders.map((r) => r.title).sort()).toEqual([
        'EVENT IN 1 HOUR',
        'EVENT IN 24 HOURS',
      ]);
    });

    it('rescheduled and cancelled events do not send stale reminders', async () => {
      const moved = await schedule({ startsAt: fromNow(2 * DAY) });
      const dropped = await schedule({ startsAt: fromNow(2 * DAY) });
      const member = await kit.member();
      await rsvp(kit.as(member), { eventId: moved.id, status: 'going' });
      await rsvp(kit.as(member), { eventId: dropped.id, status: 'going' });
      await updateEvent(kit.as(staff), { eventId: moved.id, startsAt: fromNow(5 * DAY) });
      await cancelEvent(kit.as(staff), { eventId: dropped.id, reason: 'Postponed.' });

      kit.clock.set(new Date(moved.startsAt.getTime() - HOUR));
      await kit.drain(jobHandlers);
      expect(await notificationsOf('event.reminder')).toHaveLength(0);

      kit.clock.set(fromNow(3 * DAY - HOUR));
      await kit.drain(jobHandlers);
      const [reminder] = await notificationsOf('event.reminder');
      expect(reminder!.data).toMatchObject({ eventId: moved.id });
    });

    it('a stale reminder payload is skipped by the handler', async () => {
      const event = await schedule();
      const handler = jobHandlers[CALENDAR_REMINDER_JOB]!;
      const [job] = await jobsOf(CALENDAR_REMINDER_JOB);
      const result = await handler(
        kit.system,
        { eventId: event.id, reminder: '1h', startsAt: new Date(0).toISOString() },
        job!,
      );
      expect(result).toEqual({ skipped: 'rescheduled' });
    });
  });

  describe('Discord callbacks', () => {
    it('stores Discord ids through the system-only publish callback', async () => {
      const event = await schedule();
      const publication = await getEventPublication(kit.system, event.id);
      expect(publication).toMatchObject({ revision: 0, rsvpOpen: true, announceChannelId: null });
      await markEventPublished(kit.system, {
        eventId: event.id,
        discordScheduledEventId: '123456789012345678',
        announcementChannelId: '223456789012345678',
        announcementMessageId: '323456789012345678',
      });
      const view = await getEvent(kit.system, { eventId: event.id });
      expect(view.discordScheduledEventId).toBe('123456789012345678');
    });

    it('BREAK: users cannot call bot callbacks, even staff', async () => {
      const event = await schedule();
      await expect(
        markEventPublished(kit.as(staff), {
          eventId: event.id,
          discordScheduledEventId: '123456789012345678',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getEventPublication(kit.as(staff), event.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        markEventPublished(kit.system, { eventId: event.id, discordScheduledEventId: 'abc' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('a publish that lands after cancellation re-enqueues the Discord cancel', async () => {
      const event = await schedule();
      await cancelEvent(kit.as(staff), { eventId: event.id, reason: 'Postponed.' });
      await kit.db
        .update(jobs)
        .set({ status: 'completed' })
        .where(eq(jobs.type, DISCORD_EVENTS_CANCEL_JOB));
      const result = await markEventPublished(kit.system, {
        eventId: event.id,
        discordScheduledEventId: '123456789012345678',
      });
      expect(result.status).toBe('cancelled');
      const cancels = await jobsOf(DISCORD_EVENTS_CANCEL_JOB);
      expect(cancels.filter((j) => j.status === 'pending')).toHaveLength(1);
    });
  });
});
