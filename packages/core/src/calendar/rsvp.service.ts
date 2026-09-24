import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { eventRsvps, events, members, users } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError } from '../kernel/errors';
import { type Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { publishEvent } from '../events/bus';
import { authorize, isSelf } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { MAX_EVENT_CAPACITY, RSVP_RATE_LIMIT, RSVP_RATE_WINDOW_SECONDS } from './constants';
import { enqueueAnnouncementRefresh } from './discord-jobs';
import { formatEventTime } from './format';
import { requireActiveMember } from './guards';
import {
  countGoing,
  type EventKind,
  type EventRecord,
  type EventStatus,
  findRsvp,
  loadEvent,
  OPEN_EVENT_STATUSES,
  type RsvpStatus,
  waitlistPosition,
  waitlistQueue,
} from './records';
import { notifyRecipients } from './reminders';
import { memberHistorySchema, participantsSchema, rsvpSchema } from './schemas';
import { isDeclineOpen, isRsvpOpen } from './timing';

export interface RsvpResult {
  eventId: string;
  status: RsvpStatus;
  /** 1-based; null unless waitlisted. */
  waitlistPosition: number | null;
  changed: boolean;
}

/**
 * Promote waitlisted members, oldest first, into free spots. The caller
 * holds the event row lock. Returns the promoted member ids.
 */
export async function promoteFromWaitlist(
  tx: ServiceContext,
  event: EventRecord,
): Promise<string[]> {
  if (!OPEN_EVENT_STATUSES.includes(event.status)) return [];
  const free =
    event.capacity === null
      ? MAX_EVENT_CAPACITY
      : event.capacity - (await countGoing(tx, event.id));
  if (free <= 0) return [];
  const queue = await waitlistQueue(tx, event.id, free);
  const promoted: string[] = [];
  for (const entry of queue) {
    await tx.db.update(eventRsvps).set({ status: 'going' }).where(eq(eventRsvps.id, entry.id));
    promoted.push(entry.memberId);
    await publishEvent(tx, {
      type: 'event.rsvp',
      aggregateType: 'event',
      aggregateId: event.id,
      subjectMemberId: entry.memberId,
      payload: { status: 'going', previous: 'waitlist', promoted: true },
    });
  }
  if (promoted.length > 0) {
    const recipients = await tx.db
      .select({ memberId: members.id, userId: members.userId })
      .from(members)
      .where(inArray(members.id, promoted));
    await notifyRecipients(tx, event, recipients, {
      type: 'event.waitlist',
      title: 'SPOT CONFIRMED',
      body: `${event.title} — ${formatEventTime(event.startsAt)}. A spot opened; you're going.`,
      factKey: `promoted:${tx.clock.now().getTime()}`,
    });
  }
  return promoted;
}

function nextStatus(
  requested: 'going' | 'maybe' | 'declined',
  current: RsvpStatus | null,
  full: boolean,
): RsvpStatus {
  if (requested !== 'going') return requested;
  // Already in (or queued for) the event: keep the place.
  if (current === 'going' || current === 'waitlist') return current;
  return full ? 'waitlist' : 'going';
}

/**
 * Respond to an event. 'going' beyond capacity joins the waitlist (FIFO).
 * Leaving 'going' frees a spot and promotes the next waitlisted member.
 * Serialized per event by the event row lock, so capacity holds under
 * concurrent RSVPs. Rate limited per member.
 */
export async function rsvp(
  ctx: ServiceContext,
  input: z.input<typeof rsvpSchema>,
): Promise<RsvpResult> {
  const data = parseInput(rsvpSchema, input);
  const actor = requireActiveMember(ctx);
  await consumeRateLimit(
    ctx,
    `event-rsvp:${actor.memberId}`,
    RSVP_RATE_LIMIT,
    RSVP_RATE_WINDOW_SECONDS,
  );
  return withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventOpenForRsvp(event);
    const now = tx.clock.now();
    const open = data.status === 'declined' ? isDeclineOpen(event, now) : isRsvpOpen(event, now);
    if (!open) throw new InvalidStateError('RSVPs for this event are closed.');

    const existing = await findRsvp(tx, event.id, actor.memberId, { lock: true });
    const current = existing?.status ?? null;
    const full =
      data.status === 'going' &&
      event.capacity !== null &&
      (await countGoing(tx, event.id)) >= event.capacity;
    const status = nextStatus(data.status, current, full);

    if (existing && status === current) {
      return {
        eventId: event.id,
        status,
        waitlistPosition: await waitlistPosition(tx, existing),
        changed: false,
      };
    }
    const [row] = await tx.db
      .insert(eventRsvps)
      .values({ eventId: event.id, memberId: actor.memberId, status, respondedAt: now })
      .onConflictDoUpdate({
        target: [eventRsvps.eventId, eventRsvps.memberId],
        set: { status, respondedAt: now },
      })
      .returning();
    await publishEvent(tx, {
      type: 'event.rsvp',
      aggregateType: 'event',
      aggregateId: event.id,
      subjectMemberId: actor.memberId,
      payload: { status, previous: current },
    });
    if (current === 'going') await promoteFromWaitlist(tx, event);
    await enqueueAnnouncementRefresh(tx, event);
    return {
      eventId: event.id,
      status,
      waitlistPosition: await waitlistPosition(tx, row!),
      changed: true,
    };
  });
}

function assertEventOpenForRsvp(event: EventRecord): void {
  if (!OPEN_EVENT_STATUSES.includes(event.status)) {
    throw new InvalidStateError('This event is no longer accepting responses.', {
      status: event.status,
    });
  }
}

export interface ParticipantView {
  memberId: string;
  handle: string;
  displayName: string;
  discordId: string;
  status: RsvpStatus;
  respondedAt: Date;
  checkedInAt: Date | null;
}

/** Staff: everyone who responded, grouped by status then response time. */
export async function listParticipants(
  ctx: ServiceContext,
  input: z.input<typeof participantsSchema>,
): Promise<Page<ParticipantView>> {
  const q = parseInput(participantsSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: q.eventId });
  await loadEvent(ctx, q.eventId);
  const where = q.status
    ? and(eq(eventRsvps.eventId, q.eventId), eq(eventRsvps.status, q.status))
    : eq(eventRsvps.eventId, q.eventId);
  const [items, [total]] = await Promise.all([
    ctx.db
      .select({
        memberId: members.id,
        handle: members.handle,
        displayName: members.displayName,
        discordId: users.discordId,
        status: eventRsvps.status,
        respondedAt: eventRsvps.respondedAt,
        checkedInAt: eventRsvps.checkedInAt,
      })
      .from(eventRsvps)
      .innerJoin(members, eq(members.id, eventRsvps.memberId))
      .innerJoin(users, eq(users.id, members.userId))
      .where(where)
      .orderBy(asc(eventRsvps.status), asc(eventRsvps.respondedAt), asc(eventRsvps.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(eventRsvps)
      .where(where),
  ]);
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

export interface EventHistoryItem {
  eventId: string;
  title: string;
  kind: EventKind;
  eventStatus: EventStatus;
  startsAt: Date;
  endsAt: Date;
  rsvpStatus: RsvpStatus;
  checkedInAt: Date | null;
}

/**
 * A member's event history, newest first. The member themself or event
 * staff only — no one browses another member's attendance.
 */
export async function listMemberEventHistory(
  ctx: ServiceContext,
  input: z.input<typeof memberHistorySchema>,
): Promise<Page<EventHistoryItem>> {
  const q = parseInput(memberHistorySchema, input);
  if (!isSelf(ctx.actor, q.memberId)) {
    await authorize(ctx, 'canManageEvents', { type: 'member', id: q.memberId });
  }
  const where = eq(eventRsvps.memberId, q.memberId);
  const [items, [total]] = await Promise.all([
    ctx.db
      .select({
        eventId: events.id,
        title: events.title,
        kind: events.kind,
        eventStatus: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        rsvpStatus: eventRsvps.status,
        checkedInAt: eventRsvps.checkedInAt,
      })
      .from(eventRsvps)
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(where)
      .orderBy(desc(events.startsAt), desc(events.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(eventRsvps)
      .where(where),
  ]);
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
