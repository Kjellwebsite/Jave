import { and, eq, inArray } from 'drizzle-orm';
import { eventRsvps } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { actorMemberId } from '../permissions/actor';
import { type LocationView, toLocationView } from './location';
import {
  type EventKind,
  type EventRecord,
  type EventStatus,
  OPEN_EVENT_STATUSES,
  type RsvpCounts,
  rsvpCounts,
  type RsvpStatus,
  waitlistPosition,
} from './records';
import { isRsvpOpen } from './timing';

export interface MyRsvpView {
  status: RsvpStatus;
  respondedAt: Date;
  checkedInAt: Date | null;
  /** 1-based; null unless waitlisted. */
  waitlistPosition: number | null;
}

/**
 * What members and surfaces see of an event. Never includes the check-in
 * code hash or internal Discord bookkeeping beyond the scheduled event id.
 */
export interface EventView {
  id: string;
  title: string;
  description: string | null;
  kind: EventKind;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date;
  location: LocationView | null;
  capacity: number | null;
  spotsLeft: number | null;
  rsvpClosesAt: Date | null;
  rsvpOpen: boolean;
  checkInCodeIssued: boolean;
  hostMemberId: string | null;
  discordScheduledEventId: string | null;
  counts: RsvpCounts;
  myRsvp: MyRsvpView | null;
  liveAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
}

export function toEventView(
  event: EventRecord,
  counts: RsvpCounts,
  myRsvp: MyRsvpView | null,
  now: Date,
): EventView {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    kind: event.kind,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: toLocationView(event.location),
    capacity: event.capacity,
    spotsLeft: event.capacity === null ? null : Math.max(0, event.capacity - counts.going),
    rsvpClosesAt: event.rsvpClosesAt,
    rsvpOpen: OPEN_EVENT_STATUSES.includes(event.status) && isRsvpOpen(event, now),
    checkInCodeIssued: event.checkInCodeHash !== null,
    hostMemberId: event.hostMemberId,
    discordScheduledEventId: event.discordScheduledEventId,
    counts,
    myRsvp,
    liveAt: event.liveAt,
    completedAt: event.completedAt,
    cancelledAt: event.cancelledAt,
    cancelReason: event.cancelReason,
  };
}

/** The current member's RSVPs for a page of events, in one query. */
export async function loadMyRsvps(
  ctx: ServiceContext,
  eventIds: readonly string[],
): Promise<Map<string, MyRsvpView>> {
  const out = new Map<string, MyRsvpView>();
  const memberId = actorMemberId(ctx.actor);
  if (!memberId || eventIds.length === 0) return out;
  const rows = await ctx.db
    .select()
    .from(eventRsvps)
    .where(and(eq(eventRsvps.memberId, memberId), inArray(eventRsvps.eventId, [...eventIds])));
  for (const rsvp of rows) {
    out.set(rsvp.eventId, {
      status: rsvp.status,
      respondedAt: rsvp.respondedAt,
      checkedInAt: rsvp.checkedInAt,
      waitlistPosition: await waitlistPosition(ctx, rsvp),
    });
  }
  return out;
}

/** Full view of one event from the current actor's perspective. */
export async function buildEventView(ctx: ServiceContext, event: EventRecord): Promise<EventView> {
  const counts = (await rsvpCounts(ctx, [event.id])).get(event.id)!;
  const mine = (await loadMyRsvps(ctx, [event.id])).get(event.id) ?? null;
  return toEventView(event, counts, mine, ctx.clock.now());
}
