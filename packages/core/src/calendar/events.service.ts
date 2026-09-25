import { and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { events, members, tournamentMatches } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, NotFoundError } from '../kernel/errors';
import { type Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { actorMemberId, actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { GO_LIVE_EARLIEST_BEFORE_MS } from './constants';
import {
  bumpRevision,
  cancelWindowRefreshes,
  enqueueEventCancel,
  enqueueEventPublish,
  scheduleWindowRefreshes,
} from './discord-jobs';
import { formatEventTime } from './format';
import { requireViewer } from './guards';
import {
  assertEventStatus,
  type EventRecord,
  loadEvent,
  OPEN_EVENT_STATUSES,
  rsvpCounts,
} from './records';
import { cancelReminders, notifyRecipients, rsvpRecipients, scheduleReminders } from './reminders';
import { promoteFromWaitlist } from './rsvp.service';
import {
  cancelEventSchema,
  eventIdSchema,
  listEventsSchema,
  scheduleEventSchema,
  updateEventSchema,
} from './schemas';
import { announcementRefreshTimes, resolveEventTimes, validateEventTimes } from './timing';
import { buildEventView, type EventView, loadMyRsvps, toEventView } from './views';

async function assertMemberExists(ctx: ServiceContext, memberId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!row) throw new NotFoundError('Host member');
}

/**
 * Schedule a JAVELIN event. Enqueues the Discord mirror (scheduled event +
 * announcement) and the 24 h / 1 h reminders in the same transaction.
 */
export async function scheduleEvent(
  ctx: ServiceContext,
  input: z.input<typeof scheduleEventSchema>,
): Promise<EventView> {
  const data = parseInput(scheduleEventSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event' });
  const now = ctx.clock.now();
  const times = resolveEventTimes(data);
  validateEventTimes(times, now, { requireFutureStart: true, requireFutureRsvpClose: true });
  const hostMemberId = data.hostMemberId ?? actorMemberId(ctx.actor);
  if (data.hostMemberId) await assertMemberExists(ctx, data.hostMemberId);

  const event = await withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(events)
      .values({
        title: data.title,
        description: data.description || null,
        kind: data.kind,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        rsvpClosesAt: times.rsvpClosesAt,
        location: data.location ?? null,
        capacity: data.capacity ?? null,
        hostMemberId,
        createdByUserId: actorUserId(ctx.actor),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const created = row!;
    await recordAudit(tx, {
      action: 'event.scheduled',
      targetType: 'event',
      targetId: created.id,
      context: { kind: created.kind, startsAt: created.startsAt.toISOString() },
    });
    await publishEvent(tx, {
      type: 'event.created',
      aggregateType: 'event',
      aggregateId: created.id,
      payload: {
        kind: created.kind,
        title: created.title,
        startsAt: created.startsAt.toISOString(),
        endsAt: created.endsAt.toISOString(),
      },
    });
    await enqueueEventPublish(tx, created);
    await scheduleWindowRefreshes(tx, created);
    await scheduleReminders(tx, created);
    return created;
  });
  return buildEventView(ctx, event);
}

type EventChanges = Partial<typeof events.$inferInsert>;

const sameInstants = (a: readonly Date[], b: readonly Date[]) =>
  a.length === b.length && a.every((instant, i) => instant.getTime() === b[i]!.getTime());

function fieldDiff(before: EventRecord, changes: EventChanges): Record<string, unknown> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(changes)) {
    const from = before[key as keyof EventRecord];
    const same =
      from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
    if (!same) diff[key] = { from, to };
  }
  return diff;
}

/**
 * Edit a scheduled event. A new start re-plans reminders (old reminder jobs
 * are cancelled by their dedupe keys) and notifies everyone who responded.
 * Raising the capacity promotes from the waitlist; lowering it below the
 * current attendance never removes anyone.
 */
export async function updateEvent(
  ctx: ServiceContext,
  input: z.input<typeof updateEventSchema>,
): Promise<EventView> {
  const data = parseInput(updateEventSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  if (data.hostMemberId) await assertMemberExists(ctx, data.hostMemberId);

  const updated = await withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventStatus(event, ['scheduled'], 'Only scheduled events can be edited.');
    const now = tx.clock.now();
    const startsAt = data.startsAt ?? event.startsAt;
    const duration = event.endsAt.getTime() - event.startsAt.getTime();
    const times = resolveEventTimes({
      startsAt,
      // A moved event keeps its duration unless a new end is given.
      endsAt: data.endsAt ?? new Date(startsAt.getTime() + duration),
      rsvpClosesAt: data.rsvpClosesAt === undefined ? event.rsvpClosesAt : data.rsvpClosesAt,
    });
    const rescheduled = times.startsAt.getTime() !== event.startsAt.getTime();
    validateEventTimes(times, now, {
      requireFutureStart: rescheduled,
      requireFutureRsvpClose: data.rsvpClosesAt !== undefined && data.rsvpClosesAt !== null,
    });

    if (data.kind && data.kind !== event.kind && event.kind === 'tournament') {
      const [match] = await tx.db
        .select({ id: tournamentMatches.id })
        .from(tournamentMatches)
        .where(eq(tournamentMatches.eventId, event.id))
        .limit(1);
      if (match) throw new InvalidStateError('This tournament already has a bracket.');
    }

    const changes: EventChanges = {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description || null }),
      ...(data.kind !== undefined && { kind: data.kind }),
      ...(data.location !== undefined && { location: data.location }),
      ...(data.capacity !== undefined && { capacity: data.capacity }),
      ...(data.hostMemberId !== undefined && { hostMemberId: data.hostMemberId }),
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      rsvpClosesAt: times.rsvpClosesAt,
    };
    const diff = fieldDiff(event, changes);
    if (Object.keys(diff).length === 0) return event;

    const next = await bumpRevision(tx, event.id, changes);
    await recordAudit(tx, {
      action: 'event.updated',
      targetType: 'event',
      targetId: event.id,
      context: { changes: diff },
    });
    await publishEvent(tx, {
      type: 'event.updated',
      aggregateType: 'event',
      aggregateId: event.id,
      payload: { fields: Object.keys(diff), rescheduled },
    });
    if (rescheduled) {
      await cancelReminders(tx, event);
      await scheduleReminders(tx, next);
      const recipients = await rsvpRecipients(tx, event.id, ['going', 'maybe', 'waitlist']);
      await notifyRecipients(tx, next, recipients, {
        type: 'event.updated',
        title: 'EVENT RESCHEDULED',
        body: `${next.title} now starts ${formatEventTime(next.startsAt)}.`,
        factKey: `rescheduled:${next.startsAt.getTime()}`,
      });
    }
    if (!sameInstants(announcementRefreshTimes(event), announcementRefreshTimes(next))) {
      await cancelWindowRefreshes(tx, event);
      await scheduleWindowRefreshes(tx, next);
    }
    if (data.capacity !== undefined) await promoteFromWaitlist(tx, next);
    await enqueueEventPublish(tx, next);
    return next;
  });
  return buildEventView(ctx, updated);
}

/** Cancel a scheduled or live event: attendees are told, Discord is cleaned up. */
export async function cancelEvent(
  ctx: ServiceContext,
  input: z.input<typeof cancelEventSchema>,
): Promise<EventView> {
  const data = parseInput(cancelEventSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  const cancelled = await withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventStatus(event, OPEN_EVENT_STATUSES, 'This event has already ended.');
    const now = tx.clock.now();
    const next = await bumpRevision(tx, event.id, {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: data.reason,
    });
    await cancelReminders(tx, event);
    await cancelWindowRefreshes(tx, event);
    await recordAudit(tx, {
      action: 'event.cancelled',
      targetType: 'event',
      targetId: event.id,
      context: { reason: data.reason, previousStatus: event.status },
    });
    await publishEvent(tx, {
      type: 'event.cancelled',
      aggregateType: 'event',
      aggregateId: event.id,
      payload: { reason: data.reason },
    });
    const recipients = await rsvpRecipients(tx, event.id, ['going', 'maybe', 'waitlist']);
    await notifyRecipients(tx, next, recipients, {
      type: 'event.updated',
      title: 'EVENT CANCELLED',
      body: `${next.title} (${formatEventTime(next.startsAt)}) is cancelled. ${data.reason}`,
      factKey: 'cancelled',
    });
    await enqueueEventCancel(tx, next);
    return next;
  });
  return buildEventView(ctx, cancelled);
}

/** scheduled → live. Allowed from 30 minutes before the start. */
export async function markEventLive(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<EventView> {
  const data = parseInput(eventIdSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  const live = await withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventStatus(event, ['scheduled'], 'Only a scheduled event can go live.');
    const now = tx.clock.now();
    if (now.getTime() < event.startsAt.getTime() - GO_LIVE_EARLIEST_BEFORE_MS) {
      throw new InvalidStateError('Too early to go live — reschedule the event instead.');
    }
    if (now.getTime() > event.endsAt.getTime()) {
      throw new InvalidStateError('This event is already over — complete it instead.');
    }
    const next = await bumpRevision(tx, event.id, { status: 'live', liveAt: now });
    await cancelReminders(tx, event);
    await recordAudit(tx, { action: 'event.live', targetType: 'event', targetId: event.id });
    await publishEvent(tx, {
      type: 'event.started',
      aggregateType: 'event',
      aggregateId: event.id,
      payload: { kind: event.kind },
    });
    await enqueueEventPublish(tx, next);
    return next;
  });
  return buildEventView(ctx, live);
}

export type CompletionSource = 'manual' | 'tournament' | 'sweep';

/**
 * Shared completion path (manual, tournament final, sweep). The caller holds
 * the event row lock and has checked the state.
 */
export async function completeEventInTx(
  tx: ServiceContext,
  event: EventRecord,
  source: CompletionSource,
): Promise<EventRecord> {
  const now = tx.clock.now();
  const next = await bumpRevision(tx, event.id, { status: 'completed', completedAt: now });
  await cancelReminders(tx, event);
  await cancelWindowRefreshes(tx, event);
  const counts = (await rsvpCounts(tx, [event.id])).get(event.id)!;
  await recordAudit(tx, {
    action: 'event.completed',
    targetType: 'event',
    targetId: event.id,
    context: { source },
  });
  await publishEvent(tx, {
    type: 'event.completed',
    aggregateType: 'event',
    aggregateId: event.id,
    payload: { kind: event.kind, source, going: counts.going, checkedIn: counts.checkedIn },
  });
  await enqueueEventPublish(tx, next);
  return next;
}

/** scheduled|live → completed. A scheduled event can only complete once it has started. */
export async function completeEvent(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<EventView> {
  const data = parseInput(eventIdSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  const completed = await withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventStatus(event, OPEN_EVENT_STATUSES, 'This event has already ended.');
    if (event.status === 'scheduled' && tx.clock.now().getTime() < event.startsAt.getTime()) {
      throw new InvalidStateError('This event has not started yet.');
    }
    return completeEventInTx(tx, event, 'manual');
  });
  return buildEventView(ctx, completed);
}

export async function getEvent(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<EventView> {
  requireViewer(ctx);
  const data = parseInput(eventIdSchema, input);
  return buildEventView(ctx, await loadEvent(ctx, data.eventId));
}

/**
 * Upcoming: scheduled or live events that have not ended, soonest first.
 * Past: everything else, most recent first.
 */
export async function listEvents(
  ctx: ServiceContext,
  input: z.input<typeof listEventsSchema> = {},
): Promise<Page<EventView>> {
  requireViewer(ctx);
  const q = parseInput(listEventsSchema, input);
  const now = ctx.clock.now();
  const upcoming = and(inArray(events.status, [...OPEN_EVENT_STATUSES]), gte(events.endsAt, now))!;
  const filters: SQL[] = [
    q.scope === 'upcoming'
      ? upcoming
      : or(inArray(events.status, ['completed', 'cancelled']), lt(events.endsAt, now))!,
  ];
  if (q.kind) filters.push(eq(events.kind, q.kind));
  const where = and(...filters);
  const order =
    q.scope === 'upcoming'
      ? [asc(events.startsAt), asc(events.id)]
      : [desc(events.startsAt), desc(events.id)];
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(events)
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(events)
      .where(where),
  ]);
  const ids = rows.map((row) => row.id);
  const [counts, mine] = await Promise.all([rsvpCounts(ctx, ids), loadMyRsvps(ctx, ids)]);
  const items = rows.map((row) =>
    toEventView(row, counts.get(row.id)!, mine.get(row.id) ?? null, now),
  );
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
