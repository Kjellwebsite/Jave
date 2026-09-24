import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { events } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { getSettings } from '../settings/settings.service';
import { ANNOUNCEMENT_REFRESH_DELAY_MS } from './constants';
import { requireSystemActor } from './guards';
import { type LocationView, toLocationView } from './location';
import {
  type EventKind,
  type EventRecord,
  type EventStatus,
  loadEvent,
  OPEN_EVENT_STATUSES,
  type RsvpCounts,
  rsvpCounts,
} from './records';
import { markEventPublishedSchema } from './schemas';
import { isRsvpOpen } from './timing';

/**
 * Discord job contracts for JAVELIN events. Core enqueues these inside the
 * transaction that changed the event; the bot's worker executes them
 * (apps/bot/src/features/events) and reports back through the callbacks
 * below. Handlers must be idempotent: jobs are at-least-once.
 */

const jobPayload = z.object({
  eventId: z.uuid(),
  /** events.revision when enqueued. A handler seeing a newer revision may skip: a newer job exists. */
  revision: z.number().int().min(0),
});

/**
 * `discord.events.publish` — bring Discord in line with the event (create or sync).
 *
 * The bot must:
 * 1. Load `getEventPublication(ctx, eventId)`. If `publication.revision > payload.revision`,
 *    return `{ skipped: 'superseded' }` (a newer publish job is queued).
 * 2. If `status` is `cancelled`, do nothing (the cancel job owns that path).
 * 3. Scheduled Event: create one when `discordScheduledEventId` is null, otherwise edit it —
 *    name = title, description, start/end, and either the voice/stage channel
 *    (`location.kind === 'channel'`) or an external location (`url`/`text`, or "JAVELIN"
 *    when no location is set). Set its status to ACTIVE when `status === 'live'` and
 *    COMPLETED when `status === 'completed'` (gateway extension: status on edit).
 * 4. Announcement: when `announceChannelId` is set, post (first run) or edit the
 *    announcement panel in that channel: title, time, location, capacity/spots left, and
 *    RSVP buttons with custom ids `events:rsvp:<eventId>:going|maybe|declined`, disabled
 *    when `rsvpOpen` is false. All user text through `userText()`; `allowedMentions: { parse: [] }`.
 *    Button clicks call `calendar.rsvp(ctx, …)` as the clicking user — the id never authorizes.
 * 5. Report the ids with `markEventPublished(ctx, { eventId, discordScheduledEventId,
 *    announcementChannelId, announcementMessageId })`.
 *
 * Besides one job per revision, RSVP changes enqueue a debounced count refresh of the same
 * type (at most one pending per event, 30 s delay); the handler is the same idempotent sync.
 *
 * Discord permissions: Manage Events (create/edit scheduled events); in the announcement
 * channel View Channel, Send Messages, Embed Links; for a channel location, View Channel
 * and Connect on that voice/stage channel.
 */
export const DISCORD_EVENTS_PUBLISH_JOB = 'discord.events.publish';
export const discordEventsPublishPayloadSchema = jobPayload;
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
 * 4. No callback is required; attendees are notified by core, not by the bot.
 *
 * Discord permissions: Manage Events; in the announcement channel View Channel, Send
 * Messages, Embed Links (editing its own message needs nothing more).
 */
export const DISCORD_EVENTS_CANCEL_JOB = 'discord.events.cancel';
export const discordEventsCancelPayloadSchema = jobPayload;
export type DiscordEventsCancelPayload = z.infer<typeof discordEventsCancelPayloadSchema>;

/** Bump the revision (caller holds the row) and enqueue a publish for it. */
export async function enqueueEventPublish(ctx: ServiceContext, event: EventRecord): Promise<void> {
  const payload: DiscordEventsPublishPayload = { eventId: event.id, revision: event.revision };
  await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_PUBLISH_JOB}:${event.id}:r${event.revision}`,
  });
}

/** Debounced announcement refresh after RSVP changes: at most one pending per event. */
export async function enqueueAnnouncementRefresh(
  ctx: ServiceContext,
  event: EventRecord,
): Promise<void> {
  const payload: DiscordEventsPublishPayload = { eventId: event.id, revision: event.revision };
  await enqueueJob(ctx, DISCORD_EVENTS_PUBLISH_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_PUBLISH_JOB}:${event.id}:counts`,
    delayMs: ANNOUNCEMENT_REFRESH_DELAY_MS,
  });
}

export async function enqueueEventCancel(ctx: ServiceContext, event: EventRecord): Promise<void> {
  const payload: DiscordEventsCancelPayload = { eventId: event.id, revision: event.revision };
  await enqueueJob(ctx, DISCORD_EVENTS_CANCEL_JOB, payload, {
    dedupeKey: `${DISCORD_EVENTS_CANCEL_JOB}:${event.id}:r${event.revision}`,
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

export interface EventPublication {
  eventId: string;
  revision: number;
  title: string;
  description: string | null;
  kind: EventKind;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  location: LocationView | null;
  capacity: number | null;
  counts: RsvpCounts;
  rsvpOpen: boolean;
  cancelReason: string | null;
  discordScheduledEventId: string | null;
  announcementChannelId: string | null;
  announcementMessageId: string | null;
  /** settings.channels.events — where a new announcement goes (null: no announcement). */
  announceChannelId: string | null;
}

/** Everything the bot needs to mirror an event to Discord. System actor only. */
export async function getEventPublication(
  ctx: ServiceContext,
  eventId: string,
): Promise<EventPublication> {
  requireSystemActor(ctx);
  const event = await loadEvent(ctx, parseInput(z.uuid(), eventId));
  const counts = (await rsvpCounts(ctx, [event.id])).get(event.id)!;
  const channels = await getSettings(ctx, 'channels');
  return {
    eventId: event.id,
    revision: event.revision,
    title: event.title,
    description: event.description,
    kind: event.kind,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: toLocationView(event.location),
    capacity: event.capacity,
    counts,
    rsvpOpen: OPEN_EVENT_STATUSES.includes(event.status) && isRsvpOpen(event, ctx.clock.now()),
    cancelReason: event.cancelReason,
    discordScheduledEventId: event.discordScheduledEventId,
    announcementChannelId: event.announcementChannelId,
    announcementMessageId: event.announcementMessageId,
    announceChannelId: channels.events ?? null,
  };
}

/**
 * Callback for `discord.events.publish`: store the Discord ids. Only fields
 * present in the input are written. If the event was cancelled while the bot
 * was publishing, a cancel job is enqueued so the fresh Discord objects are
 * cancelled too.
 */
export async function markEventPublished(
  ctx: ServiceContext,
  input: z.input<typeof markEventPublishedSchema>,
): Promise<{ status: EventStatus }> {
  requireSystemActor(ctx);
  const data = parseInput(markEventPublishedSchema, input);
  const event = await loadEvent(ctx, data.eventId);
  const changes: Partial<typeof events.$inferInsert> = {};
  if (data.discordScheduledEventId !== undefined) {
    changes.discordScheduledEventId = data.discordScheduledEventId;
  }
  if (data.announcementChannelId !== undefined) {
    changes.announcementChannelId = data.announcementChannelId;
  }
  if (data.announcementMessageId !== undefined) {
    changes.announcementMessageId = data.announcementMessageId;
  }
  if (Object.keys(changes).length > 0) {
    await ctx.db.update(events).set(changes).where(eq(events.id, event.id));
  }
  if (event.status === 'cancelled') await enqueueEventCancel(ctx, event);
  return { status: event.status };
}
