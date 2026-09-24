import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { jobs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR } from '../kernel/clock';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { ANNOUNCEMENT_REFRESH_WINDOW_MS } from './constants';
import { getEventPublication, markEventPublished } from './discord-callbacks';
import { DISCORD_EVENTS_CANCEL_JOB, DISCORD_EVENTS_PUBLISH_JOB } from './discord-jobs';
import { cancelEvent, completeEvent, getEvent, scheduleEvent, updateEvent } from './events.service';
import { rsvp } from './rsvp.service';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from './test-support';

const SE_A = '100000000000000001';
const SE_B = '100000000000000002';
const SE_C = '100000000000000003';
const SE_D = '100000000000000004';
const CHANNEL = '200000000000000001';
const MESSAGE_A = '300000000000000001';
const MESSAGE_B = '300000000000000002';

/** The Discord mirror of events: publication, compare-and-set callbacks, refresh jobs. */
describe('calendar Discord mirror', () => {
  let kit: TestKit;
  let staff: UserActor;

  beforeAll(warmUpTestDatabase, SNAPSHOT_BUILD_TIMEOUT_MS);
  beforeEach(async () => {
    kit = await createTestKit();
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
  const jobsLike = (type: string, keyPattern: string) =>
    kit.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, type), like(jobs.dedupeKey, keyPattern)))
      .orderBy(jobs.id);
  const markRunning = (id: number) =>
    kit.db
      .update(jobs)
      .set({ status: 'running', lockedAt: kit.clock.now(), lockedBy: 'test' })
      .where(eq(jobs.id, id));

  describe('callbacks', () => {
    it('BREAK: publication and callbacks are system-only, and reports are validated', async () => {
      const event = await schedule();
      const publication = await getEventPublication(kit.system, event.id);
      expect(publication).toMatchObject({
        revision: 0,
        rsvpOpen: true,
        declineOpen: true,
        announceChannelId: null,
        discordScheduledEventId: null,
      });
      await expect(
        markEventPublished(kit.as(staff), {
          eventId: event.id,
          revision: 0,
          scheduledEvent: { id: SE_A, replaces: null },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getEventPublication(kit.as(staff), event.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const created = { id: SE_A, replaces: null };
      const malformed: Parameters<typeof markEventPublished>[1][] = [
        { eventId: event.id, revision: 0, scheduledEvent: { id: 'abc', replaces: null } },
        {
          eventId: event.id,
          revision: 0,
          scheduledEvent: { id: SE_A, replaces: 'x'.repeat(5000) },
        },
        { eventId: event.id, revision: 0 },
        { eventId: 'not-a-uuid', revision: 0, scheduledEvent: created },
        { eventId: event.id, scheduledEvent: created } as Parameters<typeof markEventPublished>[1],
        { eventId: event.id, revision: -1, scheduledEvent: created },
        { eventId: event.id, revision: 0.5, scheduledEvent: created },
        // A revision the event never had.
        { eventId: event.id, revision: 1, scheduledEvent: created },
        {
          eventId: event.id,
          revision: 0,
          announcement: { channelId: CHANNEL, messageId: MESSAGE_A, replaces: null },
          discordScheduledEventId: SE_A,
        } as Parameters<typeof markEventPublished>[1],
      ];
      for (const input of malformed) {
        await expect(markEventPublished(kit.system, input)).rejects.toBeInstanceOf(ValidationError);
      }
      expect((await getEvent(kit.system, { eventId: event.id })).discordScheduledEventId).toBe(
        null,
      );
    });

    it('BREAK: racing creates store one object per slot; the loser is told to delete its duplicate', async () => {
      const event = await schedule();
      // Two publish runs both saw no Discord objects and both created them.
      const first = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_A, replaces: null },
        announcement: { channelId: CHANNEL, messageId: MESSAGE_A, replaces: null },
      });
      expect(first).toEqual({
        status: 'scheduled',
        stored: {
          discordScheduledEventId: SE_A,
          announcementChannelId: CHANNEL,
          announcementMessageId: MESSAGE_A,
        },
        discard: { scheduledEventId: null, announcement: null },
      });
      const second = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_B, replaces: null },
        announcement: { channelId: CHANNEL, messageId: MESSAGE_B, replaces: null },
      });
      expect(second.stored).toEqual(first.stored);
      expect(second.discard).toEqual({
        scheduledEventId: SE_B,
        announcement: { channelId: CHANNEL, messageId: MESSAGE_B },
      });

      // A retried callback for the stored object is a no-op, never a discard.
      const retried = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_A, replaces: null },
      });
      expect(retried.discard).toEqual({ scheduledEventId: null, announcement: null });

      // Re-created after deletion on Discord: replaces the id it saw.
      const recreated = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_C, replaces: SE_A },
      });
      expect(recreated.stored.discordScheduledEventId).toBe(SE_C);
      // A run that also saw SE_A, but lost to the re-create, must not overwrite it.
      const stale = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_D, replaces: SE_A },
      });
      expect(stale.discard.scheduledEventId).toBe(SE_D);
      expect((await getEvent(kit.system, { eventId: event.id })).discordScheduledEventId).toBe(
        SE_C,
      );
    });

    it('BREAK: objects stored after a cancellation get their own cancel job, even behind a running one', async () => {
      const event = await schedule();
      await cancelEvent(kit.as(staff), { eventId: event.id, reason: 'Postponed.' });
      const [inFlight] = await jobsLike(DISCORD_EVENTS_CANCEL_JOB, '%');
      // The cancel handler is mid-run: it found no Discord objects to cancel.
      await markRunning(inFlight!.id);

      const late = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_A, replaces: null },
      });
      expect(late).toMatchObject({
        status: 'cancelled',
        stored: { discordScheduledEventId: SE_A },
      });
      const cancels = await jobsLike(DISCORD_EVENTS_CANCEL_JOB, '%');
      expect(cancels.map((j) => j.status)).toEqual(['running', 'pending']);
      expect(cancels[1]!.dedupeKey).toContain(SE_A);

      // A losing duplicate stores nothing, so it needs no further cleanup job.
      const duplicate = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_B, replaces: null },
      });
      expect(duplicate.discard.scheduledEventId).toBe(SE_B);
      expect(await jobsLike(DISCORD_EVENTS_CANCEL_JOB, '%')).toHaveLength(2);
    });

    it('BREAK: objects created from an older revision get a follow-up sync', async () => {
      const event = await schedule();
      // A publish run rendered revision 0; the event was completed before it reported.
      kit.clock.set(event.startsAt);
      await completeEvent(kit.as(staff), { eventId: event.id });
      const late = await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_A, replaces: null },
      });
      expect(late.status).toBe('completed');
      let syncs = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:late:%');
      expect(syncs).toHaveLength(1);
      expect(syncs[0]).toMatchObject({ status: 'pending', payload: { eventId: event.id } });
      expect(syncs[0]!.dedupeKey).toContain(SE_A);

      // Rendered from the current revision, or discarded: nothing to re-sync.
      const current = (await getEventPublication(kit.system, event.id)).revision;
      await markEventPublished(kit.system, {
        eventId: event.id,
        revision: current,
        announcement: { channelId: CHANNEL, messageId: MESSAGE_A, replaces: null },
      });
      await markEventPublished(kit.system, {
        eventId: event.id,
        revision: 0,
        scheduledEvent: { id: SE_B, replaces: null },
      });
      syncs = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:late:%');
      expect(syncs).toHaveLength(1);
    });
  });

  describe('refresh jobs', () => {
    it('BREAK: RSVP count refreshes are never superseded and never lost behind a running refresh', async () => {
      const event = await schedule();
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      await rsvp(kit.as(a!), { eventId: event.id, status: 'going' });
      const [pending] = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:counts:%');
      // No revision: a later edit (revision 1) cannot make the handler skip it.
      expect(pending!.payload).toEqual({ eventId: event.id });
      await updateEvent(kit.as(staff), { eventId: event.id, title: 'Build Night II' });
      expect(pending!.runAt.getTime() % ANNOUNCEMENT_REFRESH_WINDOW_MS).toBe(0);
      expect(pending!.runAt.getTime() - kit.clock.now().getTime()).toBeLessThanOrEqual(
        ANNOUNCEMENT_REFRESH_WINDOW_MS,
      );

      // The refresh is due and running; another RSVP arrives meanwhile.
      kit.clock.set(pending!.runAt);
      await markRunning(pending!.id);
      await rsvp(kit.as(b!), { eventId: event.id, status: 'going' });
      const refreshes = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:counts:%');
      expect(refreshes.map((j) => j.status)).toEqual(['running', 'pending']);
      expect(refreshes[1]!.runAt.getTime()).toBe(
        pending!.runAt.getTime() + ANNOUNCEMENT_REFRESH_WINDOW_MS,
      );
    });

    it('refreshes the buttons at the RSVP close and the end, re-planned when they move', async () => {
      const event = await schedule({ rsvpClosesAt: fromNow(DAY) });
      let windows = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:at:%');
      expect(windows.map((j) => j.runAt)).toEqual([event.rsvpClosesAt, event.endsAt]);
      expect(windows.every((j) => j.payload.revision === undefined)).toBe(true);

      const closes = fromNow(DAY + 12 * HOUR);
      await updateEvent(kit.as(staff), { eventId: event.id, rsvpClosesAt: closes });
      windows = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:at:%');
      expect(windows.filter((j) => j.status === 'pending').map((j) => j.runAt)).toEqual([
        closes,
        event.endsAt,
      ]);
      expect(windows.filter((j) => j.status === 'cancelled')).toHaveLength(2);

      // After the RSVP close only declining stays open — until the end.
      kit.clock.set(closes);
      const publication = await getEventPublication(kit.system, event.id);
      expect(publication).toMatchObject({ rsvpOpen: false, declineOpen: true });
      const view = await getEvent(kit.system, { eventId: event.id });
      expect(view).toMatchObject({ rsvpOpen: false, declineOpen: true });
      kit.clock.set(event.endsAt);
      expect(await getEventPublication(kit.system, event.id)).toMatchObject({
        rsvpOpen: false,
        declineOpen: false,
      });
    });

    it('cancelling drops the pending button refreshes', async () => {
      const event = await schedule({ rsvpClosesAt: fromNow(DAY) });
      await cancelEvent(kit.as(staff), { eventId: event.id, reason: 'Postponed.' });
      const windows = await jobsLike(DISCORD_EVENTS_PUBLISH_JOB, '%:at:%');
      expect(windows.map((j) => j.status)).toEqual(['cancelled', 'cancelled']);
      expect(await getEventPublication(kit.system, event.id)).toMatchObject({
        rsvpOpen: false,
        declineOpen: false,
      });
    });
  });
});
