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
import { earliestScheduledStart } from '../../discord/scheduled-event-status';
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

/**
 * Fields for a new Scheduled Event. Discord refuses a start that has passed,
 * so an event already under way (or synced late) is listed from shortly
 * ahead; null when it ends before then — nothing is left to list.
 */
export function creatableScheduledEventSpec(
  publication: Publication,
  now: Date,
): ScheduledEventSpec | null {
  const spec = scheduledEventSpec(publication);
  const earliest = earliestScheduledStart(now);
  if (spec.startAt.getTime() >= earliest.getTime()) return spec;
  if (publication.endsAt.getTime() <= earliest.getTime()) return null;
  return { ...spec, startAt: earliest };
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
  now: Date,
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
  const spec = creatableScheduledEventSpec(publication, now);
  if (!spec) return;
  const id = await gateway.createScheduledEvent({ ...spec, reason: SYNC_REASON });
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
      // Deleted with its message or its whole channel: post a new one where announcements go now.
      const gone =
        isDiscordError(error, UNKNOWN_OBJECT.message) ||
        isDiscordError(error, UNKNOWN_OBJECT.channel);
      if (!gone) throw error;
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

/** Await `work`; Discord answering that the object (or its channel) is gone counts as done. */
async function ignoreUnknown(work: Promise<void>, ...codes: number[]): Promise<void> {
  try {
    await work;
  } catch (error) {
    if (!codes.some((code) => isDiscordError(error, code))) throw error;
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
      UNKNOWN_OBJECT.channel,
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

/**
 * Run the follow-up syncs a callback queued (a cancel or late sync for
 * objects stored after the state moved on) now rather than on the next poll.
 * Called after the event lock is released: those jobs take the same lock.
 */
async function runFollowUps(
  services: BotServices,
  ctx: ServiceContext,
  work: Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return await work;
  } finally {
    if (ctx.effects.jobIds.length > 0) {
      await services.runJobsNow(ctx.effects.jobIds).catch((error: unknown) => {
        ctx.logger.warn({ err: error }, 'follow-up event sync did not run now; the poll loop will');
      });
    }
  }
}

function publishHandler(services: BotServices, lock: KeyedLock): JobHandler {
  return async (ctx, payload) => {
    const { eventId, revision } = parsePayload(
      calendar.discordEventsPublishPayloadSchema,
      payload,
      calendar.DISCORD_EVENTS_PUBLISH_JOB,
    );
    const work = lock.run(eventId, async (): Promise<Record<string, unknown>> => {
      const publication = await calendar.getEventPublication(ctx, eventId);
      if (revision !== undefined && publication.revision > revision) {
        return { skipped: 'superseded' };
      }
      if (publication.status === 'cancelled') return { skipped: 'cancelled' };
      const message = announcementMessage(publication);
      const created: Created = {};
      const failures: unknown[] = [];
      await syncScheduledEvent(services.gateway, publication, created, ctx.clock.now()).catch(
        (error: unknown) => {
          failures.push(error);
        },
      );
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
    return runFollowUps(services, ctx, work);
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
          UNKNOWN_OBJECT.channel,
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
