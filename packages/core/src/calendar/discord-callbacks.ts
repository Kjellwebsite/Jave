import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { events } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { getSettings } from '../settings/settings.service';
import { enqueueEventCancel, enqueueLateObjectSync } from './discord-jobs';
import { discordObjectVerdict } from './discord-objects';
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
import { isDeclineOpen, isRsvpOpen } from './timing';

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
  /** Going/maybe buttons are enabled. */
  rsvpOpen: boolean;
  /** The decline button is enabled (until the end: declining frees a spot). */
  declineOpen: boolean;
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
  const now = ctx.clock.now();
  const open = OPEN_EVENT_STATUSES.includes(event.status);
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
    rsvpOpen: open && isRsvpOpen(event, now),
    declineOpen: open && isDeclineOpen(event, now),
    cancelReason: event.cancelReason,
    discordScheduledEventId: event.discordScheduledEventId,
    announcementChannelId: event.announcementChannelId,
    announcementMessageId: event.announcementMessageId,
    announceChannelId: channels.events ?? null,
  };
}

export interface AnnouncementRef {
  channelId: string;
  messageId: string;
}

export interface EventPublishedResult {
  status: EventStatus;
  /** What core holds after the call — authoritative for the rest of the bot's run. */
  stored: {
    discordScheduledEventId: string | null;
    announcementChannelId: string | null;
    announcementMessageId: string | null;
  };
  /** Reported objects that lost the compare-and-set: duplicates the bot must delete. */
  discard: { scheduledEventId: string | null; announcement: AnnouncementRef | null };
}

/**
 * Callback for `discord.events.publish`: store the objects the bot created,
 * compare-and-set per slot (see `discordObjectVerdict`). Runs under the
 * event row lock, so a concurrent change is either seen here or sees the
 * stored ids. Objects stored after a cancellation get their own cancel job;
 * objects rendered from an older revision get their own sync job.
 */
export async function markEventPublished(
  ctx: ServiceContext,
  input: z.input<typeof markEventPublishedSchema>,
): Promise<EventPublishedResult> {
  requireSystemActor(ctx);
  const data = parseInput(markEventPublishedSchema, input);
  return withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    if (data.revision > event.revision) {
      throw new ValidationError('revision: is ahead of the event');
    }
    const changes: Partial<typeof events.$inferInsert> = {};
    const discard: EventPublishedResult['discard'] = { scheduledEventId: null, announcement: null };
    const stored: string[] = [];

    const scheduled = data.scheduledEvent;
    if (scheduled) {
      const verdict = discordObjectVerdict(
        event.discordScheduledEventId,
        scheduled.id,
        scheduled.replaces,
      );
      if (verdict === 'store') {
        changes.discordScheduledEventId = scheduled.id;
        stored.push(scheduled.id);
      } else if (verdict === 'discard') {
        discard.scheduledEventId = scheduled.id;
      }
    }
    const announcement = data.announcement;
    if (announcement) {
      const verdict = discordObjectVerdict(
        event.announcementMessageId,
        announcement.messageId,
        announcement.replaces,
      );
      if (verdict === 'store') {
        changes.announcementChannelId = announcement.channelId;
        changes.announcementMessageId = announcement.messageId;
        stored.push(announcement.messageId);
      } else if (verdict === 'discard') {
        discard.announcement = {
          channelId: announcement.channelId,
          messageId: announcement.messageId,
        };
      }
    }

    let current: EventRecord = event;
    if (stored.length > 0) {
      const [row] = await tx.db
        .update(events)
        .set(changes)
        .where(eq(events.id, event.id))
        .returning();
      current = row!;
      if (current.status === 'cancelled') {
        await enqueueEventCancel(tx, current, stored);
      } else if (data.revision < current.revision) {
        // Created from an older publication: the job for the newer revision may
        // already have run without seeing these objects.
        await enqueueLateObjectSync(tx, current, stored);
      }
    }
    return {
      status: current.status,
      stored: {
        discordScheduledEventId: current.discordScheduledEventId,
        announcementChannelId: current.announcementChannelId,
        announcementMessageId: current.announcementMessageId,
      },
      discard,
    };
  });
}
