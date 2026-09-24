import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { events } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { cancelJob, enqueueJob } from '../jobs/queue';
import { ANNOUNCEMENT_REFRESH_WINDOW_MS } from './constants';
import type { EventRecord } from './records';
import { announcementRefreshTimes, countsRefreshDueAt } from './timing';

/**
 * Discord job contracts for JAVELIN events. Core enqueues these inside the
 * transaction that changed the event; the bot's worker executes them
 * (apps/bot/src/features/events) and reports back through the callbacks in
 * `discord-callbacks.ts`. Jobs are at-least-once and several can be due for
 * one event, so handlers are idempotent full syncs.
 *
 * Serialization: the bot runs at most one `discord.events.*` handler per
 * event at a time (a per-event lock in the worker process). Core's
 * compare-and-set callback is the backstop when runs still overlap (two bot
 * processes during a deploy): it stores one object per slot and tells the
 * losing run to delete its duplicate.
 */

const publishPayload = z.object({
  eventId: z.uuid(),
  /**
   * events.revision when a change enqueued the job. Absent on refreshes
   * (RSVP counts, RSVP close, event end): those are never skipped.
   */
  revision: z.number().int().min(0).optional(),
});

const cancelPayload = z.object({
  eventId: z.uuid(),
  /** events.revision of the cancellation (informational; the handler checks the status). */
  revision: z.number().int().min(0),
});

/**
 * `discord.events.publish` — bring Discord in line with the event (create or sync).
 *
 * The bot must:
 * 1. Load `getEventPublication(ctx, eventId)`. If `payload.revision` is set and
 *    `publication.revision > payload.revision`, return `{ skipped: 'superseded' }` (a newer
 *    publish job exists). A payload without `revision` is a refresh and always runs.
 * 2. If `status` is `cancelled`, do nothing (the cancel job owns that path).
 * 3. Scheduled Event: edit `discordScheduledEventId` when set — name = title, description,
 *    start/end, and either the voice/stage channel (`location.kind === 'channel'`) or an
 *    external location (`url`/`text`, or "JAVELIN" when no location is set); status ACTIVE
 *    when `status === 'live'`, COMPLETED when `status === 'completed'` (gateway extension:
 *    status on edit). When it is null (or Discord answers Unknown Scheduled Event) and the
 *    status is `scheduled` or `live`, create one. Never create for a completed event.
 * 4. Announcement: when `announcementMessageId` is set, edit that message in
 *    `announcementChannelId`; otherwise, when `announceChannelId` is set and the status is
 *    `scheduled` or `live`, post one there (also after Unknown Message). Panel: title, time,
 *    location, capacity/spots left, and RSVP buttons with custom ids
 *    `events:rsvp:<eventId>:going|maybe|declined` — going and maybe disabled when `rsvpOpen`
 *    is false, declined disabled when `declineOpen` is false. All user text through
 *    `userText()`; `allowedMentions: { parse: [] }`. Button clicks call `calendar.rsvp(ctx, …)`
 *    as the clicking user — the id never authorizes.
 * 5. Report only what it created, with the publication's `revision` and the id the
 *    publication showed for that slot: `markEventPublished(ctx, { eventId, revision,
 *    scheduledEvent: { id, replaces }, announcement: { channelId, messageId, replaces } })`
 *    (`replaces` is null for a first create). Then delete every object listed in the
 *    result's `discard` — another run stored its own first — and apply the same content to
 *    the objects in `result.stored`.
 *
 * Besides one job per revision, core enqueues refreshes of the same type (no revision):
 * one per 30 s window after RSVP changes, one at the RSVP close, one at the end, and one
 * when a run stores objects it rendered from an older revision.
 *
 * Discord permissions: Manage Events (create/edit/delete scheduled events); in the
 * announcement channel View Channel, Send Messages, Embed Links (deleting its own message
 * needs nothing more); for a channel location, View Channel and Connect on that
 * voice/stage channel.
 */
export const DISCORD_EVENTS_PUBLISH_JOB = 'discord.events.publish';
export const discordEventsPublishPayloadSchema = publishPayload;
export type DiscordEventsPublishPayload = z.infer<typeof discordEventsPublishPayloadSchema>;

/**
 * `discord.events.cancel` — the event was cancelled.
 *
 * The bot must:
 * 1. Load `getEventPublication(ctx, eventId)`; if `status !== 'cancelled'` return skipped.
 * 2. Cancel the Scheduled Event when `discordScheduledEventId` is set (unknown/already
 *    cancelled events count as success).
 * 3. Edit the announcement (when `announcementChannelId`/`announcementMessageId` are set) to a
 *    CANCELLED panel with `cancelReason`, and remove the RSVP buttons.
 * 4. No callback is required; attendees are notified by core, not by the bot. When a publish
 *    run stores new objects after the cancellation, core enqueues another cancel job.
 *
 * Discord permissions: Manage Events; in the announcement channel View Channel, Send
 * Messages, Embed Links (editing its own message needs nothing more).
 */
export const DISCORD_EVENTS_CANCEL_JOB = 'discord.events.cancel';
export const discordEventsCancelPayloadSchema = cancelPayload;
export type DiscordEventsCancelPayload = z.infer<typeof discordEventsCancelPayloadSchema>;

/** Publish the revision the caller just wrote (caller holds the row). */
export async function enqueueEventPublish(ctx: ServiceContext, event: EventRecord): Promise<void> {
  const payload: DiscordEventsPublishPayload = { eventId: event.id, revision: event.revision };
  await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_PUBLISH_JOB}:${event.id}:r${event.revision}`,
  });
}

/**
 * Debounced announcement refresh after RSVP changes: one job per event per
 * window, due at the window's end. No revision — a refresh is never skipped.
 */
export async function enqueueAnnouncementRefresh(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<void> {
  const dueAt = countsRefreshDueAt(ctx.clock.now(), ANNOUNCEMENT_REFRESH_WINDOW_MS);
  const payload: DiscordEventsPublishPayload = { eventId: event.id };
  await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_PUBLISH_JOB}:${event.id}:counts:${dueAt.getTime()}`,
    runAt: dueAt,
  });
}

const windowRefreshKey = (eventId: string, at: Date) =>
  `${DISCORD_EVENTS_PUBLISH_JOB}:${eventId}:at:${at.getTime()}`;

/** Refresh the announcement when its buttons change on their own (RSVP close, end). */
export async function scheduleWindowRefreshes(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<void> {
  const now = ctx.clock.now().getTime();
  for (const at of announcementRefreshTimes(event)) {
    if (at.getTime() <= now) continue;
    const payload: DiscordEventsPublishPayload = { eventId: event.id };
    await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
      dedupeKey: windowRefreshKey(event.id, at),
      runAt: at,
    });
  }
}

/** Cancel the pending window refreshes planned for the event's (previous) times. */
export async function cancelWindowRefreshes(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<void> {
  for (const at of announcementRefreshTimes(event)) {
    await cancelJob(ctx, windowRefreshKey(event.id, at));
  }
}

/**
 * Re-sync objects a publish run created from an older revision: the job for
 * the newer revision may have run before they were stored. Keyed by the new
 * object ids, so it never collides with a live publish job.
 */
export async function enqueueLateObjectSync(
  ctx: ServiceContext,
  event: EventRecord,
  lateObjectIds: readonly string[],
): Promise<void> {
  const payload: DiscordEventsPublishPayload = { eventId: event.id };
  await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_PUBLISH_JOB}:${event.id}:late:${lateObjectIds.join(':')}`,
  });
}

/**
 * Enqueue the Discord cleanup for a cancelled event. `lateObjectIds` are
 * objects a publish run stored after the cancellation: they make the key
 * unique, so the job is never dropped behind a cancel run that is still in
 * flight and saw no objects.
 */
export async function enqueueEventCancel(
  ctx: ServiceContext,
  event: EventRecord,
  lateObjectIds: readonly string[] = [],
): Promise<void> {
  const payload: DiscordEventsCancelPayload = { eventId: event.id, revision: event.revision };
  const late = lateObjectIds.length > 0 ? `:late:${lateObjectIds.join(':')}` : '';
  await enqueueJob(ctx, DISCORD_EVENTS_CANCEL_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_CANCEL_JOB}:${event.id}:r${event.revision}${late}`,
  });
}

/** Increment events.revision; returns the updated row. */
export async function bumpRevision(
  ctx: ServiceContext,
  eventId: string,
  changes: Partial<typeof events.$inferInsert> = {},
): Promise<EventRecord> {
  const [row] = await ctx.db
    .update(events)
    .set({ ...changes, revision: sql`${events.revision} + 1`, updatedAt: ctx.clock.now() })
    .where(eq(events.id, eventId))
    .returning();
  return row!;
}
