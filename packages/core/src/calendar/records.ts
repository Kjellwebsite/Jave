import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { eventRsvps, events } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { InvalidStateError, NotFoundError } from '../kernel/errors';

export type EventRecord = typeof events.$inferSelect;
export type EventStatus = EventRecord['status'];
export type EventKind = EventRecord['kind'];
export type RsvpRecord = typeof eventRsvps.$inferSelect;
export type RsvpStatus = RsvpRecord['status'];

/** States in which an event still accepts RSVPs, check-ins and edits. */
export const OPEN_EVENT_STATUSES: readonly EventStatus[] = ['scheduled', 'live'];

export async function loadEvent(
  ctx: Pick<ServiceContext, 'db'>,
  eventId: string,
  options: { lock?: boolean } = {},
): Promise<EventRecord> {
  const query = ctx.db.select().from(events).where(eq(events.id, eventId));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('Event');
  return row;
}

export function assertEventStatus(
  event: EventRecord,
  allowed: readonly EventStatus[],
  message: string,
): void {
  if (!allowed.includes(event.status)) {
    throw new InvalidStateError(message, { status: event.status });
  }
}

export interface RsvpCounts {
  going: number;
  maybe: number;
  declined: number;
  waitlist: number;
  checkedIn: number;
}

const emptyCounts = (): RsvpCounts => ({
  going: 0,
  maybe: 0,
  declined: 0,
  waitlist: 0,
  checkedIn: 0,
});

export async function rsvpCounts(
  ctx: Pick<ServiceContext, 'db'>,
  eventIds: readonly string[],
): Promise<Map<string, RsvpCounts>> {
  const out = new Map<string, RsvpCounts>();
  if (eventIds.length === 0) return out;
  const rows = await ctx.db
    .select({
      eventId: eventRsvps.eventId,
      status: eventRsvps.status,
      total: sql<number>`count(*)::int`,
      checkedIn: sql<number>`count(${eventRsvps.checkedInAt})::int`,
    })
    .from(eventRsvps)
    .where(inArray(eventRsvps.eventId, [...eventIds]))
    .groupBy(eventRsvps.eventId, eventRsvps.status);
  for (const id of eventIds) out.set(id, emptyCounts());
  for (const row of rows) {
    const counts = out.get(row.eventId) ?? emptyCounts();
    counts[row.status] = row.total;
    counts.checkedIn += row.checkedIn;
    out.set(row.eventId, counts);
  }
  return out;
}

export async function countGoing(ctx: Pick<ServiceContext, 'db'>, eventId: string) {
  const [row] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, 'going')));
  return row?.total ?? 0;
}

export async function findRsvp(
  ctx: Pick<ServiceContext, 'db'>,
  eventId: string,
  memberId: string,
  options: { lock?: boolean } = {},
): Promise<RsvpRecord | null> {
  const query = ctx.db
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
  const [row] = options.lock ? await query.for('update') : await query;
  return row ?? null;
}

/** 1-based FIFO position on the waitlist (ties broken by row id). */
export async function waitlistPosition(
  ctx: Pick<ServiceContext, 'db'>,
  rsvp: RsvpRecord,
): Promise<number | null> {
  if (rsvp.status !== 'waitlist') return null;
  const [row] = await ctx.db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(eventRsvps)
    .where(
      and(
        eq(eventRsvps.eventId, rsvp.eventId),
        eq(eventRsvps.status, 'waitlist'),
        or(
          lt(eventRsvps.respondedAt, rsvp.respondedAt),
          and(eq(eventRsvps.respondedAt, rsvp.respondedAt), lt(eventRsvps.id, rsvp.id)),
        ),
      ),
    );
  return (row?.ahead ?? 0) + 1;
}

/** Waitlisted RSVPs in promotion order. */
export async function waitlistQueue(
  ctx: Pick<ServiceContext, 'db'>,
  eventId: string,
  limit: number,
): Promise<RsvpRecord[]> {
  return ctx.db
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.status, 'waitlist')))
    .orderBy(asc(eventRsvps.respondedAt), asc(eventRsvps.id))
    .limit(limit)
    .for('update');
}
