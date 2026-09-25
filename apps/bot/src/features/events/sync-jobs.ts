import {
  calendar,
  type JobHandler,
  type JobHandlerMap,
  PermanentJobError,
  type ServiceContext,
} from '@jave/core';
import {
  isDiscordError,
  isPermanentDiscordError,
  jobFailure,
  UNKNOWN_OBJECT,
} from '../../discord/discord-errors';
import type {
  DiscordGateway,
  MessagePayload,
  ScheduledEventEdit,
  ScheduledEventSpec,
} from '../../discord/gateway';
import { KeyedLock } from '../../discord/keyed-lock';
import type { BotServices } from '../../runtime';
import { announcementMessage, cancelledAnnouncement } from './render-event';

const SYNC_REASON = 'JAVELIN event sync';
const CANCEL_REASON = 'JAVELIN event cancelled';
const DUPLICATE_REASON = 'JAVELIN duplicate from an overlapping sync';
/** Shown as the external location when an event has none (Discord requires one). */
const DEFAULT_LOCATION = 'JAVELIN';

type Publication = calendar.EventPublication;

/** Scheduled Event fields from the publication. Discord renders these itself; no mentions ping. */
export function scheduledEventSpec(publication: Publication): ScheduledEventSpec {
  const base = {
    name: publication.title,
    description: publication.description ?? undefined,
    startAt: publication.startsAt,
    endAt: publication.endsAt,
  };
  const location = publication.location;
  if (location?.kind === 'channel') return { ...base, channelId: location.value };
  return { ...base, location: location?.value ?? DEFAULT_LOCATION };
}

function targetStatus(publication: Publication): ScheduledEventEdit['status'] {
  if (publication.status === 'live') return 'active';
  if (publication.status === 'completed') return 'completed';
  return undefined;
}

const isOpen = (publication: Publication) =>
  publication.status === 'scheduled' || publication.status === 'live';

/** Objects this run created, reported to core with the id the publication showed for the slot. */
interface Created {
  scheduledEvent?: { id: string; replaces: string | null };
  announcement?: { channelId: string; messageId: string; replaces: string | null };
}

async function syncScheduledEvent(
  gateway: DiscordGateway,
  publication: Publication,
  created: Created,
): Promise<void> {
  const edit: ScheduledEventEdit = {
    ...scheduledEventSpec(publication),
    status: targetStatus(publication),
  };
  const existing = publication.discordScheduledEventId;
  if (existing) {
    try {
      await gateway.editScheduledEvent(existing, edit, SYNC_REASON);
      return;
    } catch (error) {
      if (!isDiscordError(error, UNKNOWN_OBJECT.scheduledEvent)) throw error;
    }
  }
  // Never create one for a completed event: it would only announce the past.
  if (!isOpen(publication)) return;
  const id = await gateway.createScheduledEvent({
    ...scheduledEventSpec(publication),
    reason: SYNC_REASON,
  });
  created.scheduledEvent = { id, replaces: existing };
  if (publication.status === 'live') {
    await gateway.editScheduledEvent(id, { status: 'active' }, SYNC_REASON);
  }
}

async function syncAnnouncement(
  gateway: DiscordGateway,
  publication: Publication,
  message: MessagePayload,
  created: Created,
): Promise<void> {
  const { announcementChannelId: channelId, announcementMessageId: messageId } = publication;
  if (channelId && messageId) {
    try {
      await gateway.editMessage(channelId, messageId, message);
      return;
    } catch (error) {
      if (!isDiscordError(error, UNKNOWN_OBJECT.message)) throw error;
    }
  }
  if (!isOpen(publication) || !publication.announceChannelId) return;
  const sent = await gateway.sendMessage(publication.announceChannelId, message);
  created.announcement = {
    channelId: sent.channelId,
    messageId: sent.messageId,
    replaces: messageId,
  };
}

async function ignoreUnknown(work: Promise<void>, code: number): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (!isDiscordError(error, code)) throw error;
  }
}

/**
 * Report created objects. Another run may have stored its own first: then
 * ours is a duplicate to delete, and the stored one gets this run's content.
 */
async function reportCreated(
  ctx: ServiceContext,
  gateway: DiscordGateway,
  publication: Publication,
  message: MessagePayload,
  created: Created,
): Promise<void> {
  const result = await calendar.markEventPublished(ctx, {
    eventId: publication.eventId,
    revision: publication.revision,
    ...created,
  });
  const { discard, stored } = result;
  if (discard.scheduledEventId) {
    await ignoreUnknown(
      gateway.deleteScheduledEvent(discard.scheduledEventId, DUPLICATE_REASON),
      UNKNOWN_OBJECT.scheduledEvent,
    );
    if (stored.discordScheduledEventId && result.status !== 'cancelled') {
      await gateway.editScheduledEvent(
        stored.discordScheduledEventId,
        { ...scheduledEventSpec(publication), status: targetStatus(publication) },
        SYNC_REASON,
      );
    }
  }
  if (discard.announcement) {
    await ignoreUnknown(
      gateway.deleteMessage(
        discard.announcement.channelId,
        discard.announcement.messageId,
        DUPLICATE_REASON,
      ),
      UNKNOWN_OBJECT.message,
    );
    if (
      stored.announcementChannelId &&
      stored.announcementMessageId &&
      result.status !== 'cancelled'
    ) {
      await gateway.editMessage(
        stored.announcementChannelId,
        stored.announcementMessageId,
        message,
      );
    }
  }
}

/**
 * Several failures from one run: retry while any of them might clear up; only
 * when every one is permanent does the job dead-letter.
 */
function combinedFailure(failures: readonly unknown[]): unknown {
  const transient = failures.find((failure) => !isPermanentDiscordError(failure));
  return transient ?? jobFailure(failures[0]);
}

function parsePayload<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  payload: Record<string, unknown>,
  type: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError(`invalid ${type} payload`);
  return parsed.data;
}

function publishHandler(services: BotServices, lock: KeyedLock): JobHandler {
  return async (ctx, payload) => {
    const { eventId, revision } = parsePayload(
      calendar.discordEventsPublishPayloadSchema,
      payload,
      calendar.DISCORD_EVENTS_PUBLISH_JOB,
    );
    return lock.run(eventId, async () => {
      const publication = await calendar.getEventPublication(ctx, eventId);
      if (revision !== undefined && publication.revision > revision) {
        return { skipped: 'superseded' };
      }
      if (publication.status === 'cancelled') return { skipped: 'cancelled' };
      const message = announcementMessage(publication);
      const created: Created = {};
      const failures: unknown[] = [];
      await syncScheduledEvent(services.gateway, publication, created).catch((error: unknown) => {
        failures.push(error);
      });
      await syncAnnouncement(services.gateway, publication, message, created).catch(
        (error: unknown) => {
          failures.push(error);
        },
      );
      // Report before failing: a retry must never create what this run already created.
      if (created.scheduledEvent || created.announcement) {
        await reportCreated(ctx, services.gateway, publication, message, created).catch(
          (error: unknown) => {
            failures.push(error);
          },
        );
      }
      if (failures.length > 0) throw combinedFailure(failures);
      return {
        revision: publication.revision,
        status: publication.status,
        createdScheduledEvent: created.scheduledEvent?.id ?? null,
        createdAnnouncement: created.announcement?.messageId ?? null,
      };
    });
  };
}

function cancelHandler(services: BotServices, lock: KeyedLock): JobHandler {
  return async (ctx, payload) => {
    const { eventId } = parsePayload(
      calendar.discordEventsCancelPayloadSchema,
      payload,
      calendar.DISCORD_EVENTS_CANCEL_JOB,
    );
    return lock.run(eventId, async () => {
      const publication = await calendar.getEventPublication(ctx, eventId);
      if (publication.status !== 'cancelled') return { skipped: 'not cancelled' };
      const { gateway } = services;
      const failures: unknown[] = [];
      if (publication.discordScheduledEventId) {
        await ignoreUnknown(
          gateway.cancelScheduledEvent(publication.discordScheduledEventId, CANCEL_REASON),
          UNKNOWN_OBJECT.scheduledEvent,
        ).catch((error: unknown) => {
          failures.push(error);
        });
      }
      const { announcementChannelId: channelId, announcementMessageId: messageId } = publication;
      if (channelId && messageId) {
        await ignoreUnknown(
          gateway.editMessage(channelId, messageId, cancelledAnnouncement(publication)),
          UNKNOWN_OBJECT.message,
        ).catch((error: unknown) => {
          failures.push(error);
        });
      }
      if (failures.length > 0) throw combinedFailure(failures);
      return { cancelled: true };
    });
  };
}

/** discord.events.publish and discord.events.cancel, serialized per event in this process. */
export function eventJobHandlers(services: BotServices): JobHandlerMap {
  const lock = new KeyedLock();
  return {
    [calendar.DISCORD_EVENTS_PUBLISH_JOB]: publishHandler(services, lock),
    [calendar.DISCORD_EVENTS_CANCEL_JOB]: cancelHandler(services, lock),
  };
}
