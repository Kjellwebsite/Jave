import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { eventRsvps, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { cancelJob, enqueueJob } from '../jobs/queue';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import type { NotificationType } from '../notifications/catalog';
import { notify } from '../notifications/notifications.service';
import { CALENDAR_REMINDER_JOB, EVENT_REMINDERS, type ReminderKey } from './constants';
import { formatEventTime } from './format';
import { type EventRecord, loadEvent, type RsvpStatus } from './records';
import { plannedReminders } from './timing';

const reminderKeys = EVENT_REMINDERS.map((reminder) => reminder.key) as [
  ReminderKey,
  ...ReminderKey[],
];

export const reminderPayloadSchema = z.object({
  eventId: z.uuid(),
  reminder: z.enum(reminderKeys),
  /** The start this reminder was planned for; a rescheduled event makes it stale. */
  startsAt: z.iso.datetime(),
});
export type ReminderPayload = z.infer<typeof reminderPayloadSchema>;

/** The start time is part of the key, so a reschedule never collides with an in-flight job. */
export function reminderDedupeKey(eventId: string, key: ReminderKey, startsAt: Date): string {
  return `${CALENDAR_REMINDER_JOB}:${eventId}:${key}:${startsAt.getTime()}`;
}

/** Enqueue the reminders that are still in the future. */
export async function scheduleReminders(ctx: ServiceContext, event: EventRecord): Promise<number> {
  let scheduled = 0;
  for (const reminder of plannedReminders(event.startsAt, ctx.clock.now())) {
    const payload: ReminderPayload = {
      eventId: event.id,
      reminder: reminder.key,
      startsAt: event.startsAt.toISOString(),
    };
    const id = await enqueueJob(ctx, CALENDAR_REMINDER_JOB, payload, {
      runAt: reminder.runAt,
      dedupeKey: reminderDedupeKey(event.id, reminder.key, event.startsAt),
    });
    if (id !== null) scheduled++;
  }
  return scheduled;
}

/** Cancel pending reminders planned for the event's (previous) start. */
export async function cancelReminders(ctx: ServiceContext, event: EventRecord): Promise<number> {
  let cancelled = 0;
  for (const reminder of EVENT_REMINDERS) {
    cancelled += await cancelJob(ctx, reminderDedupeKey(event.id, reminder.key, event.startsAt));
  }
  return cancelled;
}

export interface Recipient {
  memberId: string;
  userId: string;
}

/** Members (not deleted) holding one of `statuses` for the event. */
export async function rsvpRecipients(
  ctx: Pick<ServiceContext, 'db'>,
  eventId: string,
  statuses: readonly RsvpStatus[],
): Promise<Recipient[]> {
  return ctx.db
    .select({ memberId: members.id, userId: members.userId })
    .from(eventRsvps)
    .innerJoin(members, eq(members.id, eventRsvps.memberId))
    .where(
      and(
        eq(eventRsvps.eventId, eventId),
        inArray(eventRsvps.status, [...statuses]),
        isNull(members.deletedAt),
      ),
    );
}

export function eventUrl(ctx: ServiceContext, eventId: string): string | undefined {
  return ctx.config.publicUrl
    ? `${ctx.config.publicUrl.replace(/\/+$/, '')}/events/${eventId}`
    : undefined;
}

/** One notification per recipient, deduplicated per member on `factKey`. */
export async function notifyRecipients(
  ctx: ServiceContext,
  event: EventRecord,
  recipients: readonly Recipient[],
  message: { type: NotificationType; title: string; body: string; factKey: string },
): Promise<number> {
  let sent = 0;
  for (const recipient of recipients) {
    const id = await notify(ctx, {
      recipientUserId: recipient.userId,
      type: message.type,
      title: message.title,
      body: message.body,
      url: eventUrl(ctx, event.id),
      data: { eventId: event.id, startsAt: event.startsAt.toISOString() },
      dedupeKey: `event:${event.id}:${message.factKey}:${recipient.memberId}`,
    });
    if (id) sent++;
  }
  return sent;
}

/**
 * `calendar.reminder`: notify members who are going. Skips events that were
 * cancelled, completed or moved since the reminder was planned.
 */
export const reminderJobHandler: JobHandler = async (ctx, rawPayload) => {
  const parsed = reminderPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) throw new PermanentJobError('invalid reminder payload');
  const payload = parsed.data;
  const event = await loadEvent(ctx, payload.eventId);
  if (event.status !== 'scheduled') return { skipped: `event ${event.status}` };
  if (event.startsAt.toISOString() !== new Date(payload.startsAt).toISOString()) {
    return { skipped: 'rescheduled' };
  }
  const definition = EVENT_REMINDERS.find((reminder) => reminder.key === payload.reminder)!;
  const recipients = await rsvpRecipients(ctx, event.id, ['going']);
  const notified = await notifyRecipients(ctx, event, recipients, {
    type: 'event.reminder',
    title: definition.title,
    body: `${event.title} — ${formatEventTime(event.startsAt)}. You're confirmed.`,
    factKey: `reminder:${payload.reminder}:${event.startsAt.getTime()}`,
  });
  return { notified };
};
