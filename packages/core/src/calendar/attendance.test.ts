import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  events,
  jobs,
  notificationDeliveries,
  notifications,
} from '@jave/database';
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
import { cancelEvent, getEvent, scheduleEvent, updateEvent } from './events.service';
import { checkIn, generateCheckInCode } from './check-in.service';
import { rsvp } from './rsvp.service';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from './test-support';
import { jobHandlers } from './index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Check-in and reminders. */
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

    it('BREAK: a reminder that fails mid-delivery leaves nothing half-written; the retry delivers', async () => {
      const event = await schedule({ startsAt: fromNow(2 * DAY) });
      const [first, second] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(first!), { eventId: event.id, status: 'going' });
      await rsvp(kit.as(second!), { eventId: event.id, status: 'going' });
      await kit.drain(jobHandlers);

      // The delivery store fails for the first recipient only. (DDL takes no
      // bind parameters; the id is a UUID this test just created.)
      expect(first!.userId).toMatch(UUID);
      await kit.db.execute(
        sql.raw(`
        create function test_fail_delivery() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from notifications n
                     where n.id = new.notification_id
                       and n.recipient_user_id = '${first!.userId}'::uuid) then
            raise exception 'delivery store unavailable';
          end if;
          return new;
        end $$`),
      );
      await kit.db.execute(sql`
        create trigger test_fail_delivery before insert on notification_deliveries
        for each row execute function test_fail_delivery()`);

      kit.clock.set(new Date(event.startsAt.getTime() - DAY));
      const [outcome] = await kit.drain(jobHandlers);
      expect(outcome).toMatchObject({ type: CALENDAR_REMINDER_JOB, status: 'retry' });
      const stranded = await notificationsOf('event.reminder');
      expect(stranded.map((n) => n.recipientUserId)).not.toContain(first!.userId);

      await kit.db.execute(sql`drop trigger test_fail_delivery on notification_deliveries`);
      kit.clock.advance(MINUTE);
      await kit.drain(jobHandlers);
      const reminders = await notificationsOf('event.reminder');
      expect(reminders.map((n) => n.recipientUserId).sort()).toEqual(
        [first!.userId, second!.userId].sort(),
      );
      const deliveries = await kit.db
        .select()
        .from(notificationDeliveries)
        .where(
          inArray(
            notificationDeliveries.notificationId,
            reminders.map((n) => n.id),
          ),
        );
      expect(deliveries).toHaveLength(2);
    });
  });
});
