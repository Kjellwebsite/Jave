import { and, count, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { modAction, modCases, securityEvents, securityTrigger, tickets } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { countWhere, medianDuration, SECONDS_PER_MINUTE, within } from '../sql';
import { tally, type TimeWindow } from '../window';

export type ModAction = (typeof modAction.enumValues)[number];
export type SecurityTrigger = (typeof securityTrigger.enumValues)[number];

export interface TicketCounts {
  /** Open, claimed or waiting right now. */
  open: number;
  opened: number;
  medianFirstResponseMinutes: number | null;
  /** Tickets opened in the window whose SLA outcome is known. */
  slaTracked: number;
  slaBreached: number;
}

/**
 * Ticket health for tickets opened in `window`. SLA outcome is known once a
 * first response exists or the due time has passed (`asOf`). A breach is a
 * recorded breach, a late first response, or no response past the due time.
 */
export async function ticketCounts(
  ctx: ServiceContext,
  window: TimeWindow,
  asOf: Date,
): Promise<TicketCounts> {
  const due = tickets.slaFirstResponseDueAt;
  const responded = tickets.firstResponseAt;
  const outcomeKnown = and(isNotNull(due), or(isNotNull(responded), lte(due, asOf)));
  const breached = and(
    outcomeKnown,
    or(
      isNotNull(tickets.slaBreachedAt),
      gt(responded, due),
      and(isNull(responded), lte(due, asOf)),
    ),
  );
  const [[open], [flow]] = await Promise.all([
    ctx.db
      .select({ value: count() })
      .from(tickets)
      .where(inArray(tickets.status, ['open', 'claimed', 'waiting'])),
    ctx.db
      .select({
        opened: count(),
        medianMinutes: medianDuration(
          tickets.createdAt,
          responded,
          SECONDS_PER_MINUTE,
          isNotNull(responded),
        ),
        slaTracked: countWhere(outcomeKnown),
        slaBreached: countWhere(breached),
      })
      .from(tickets)
      .where(within(tickets.createdAt, window)),
  ]);
  return {
    open: open?.value ?? 0,
    opened: flow?.opened ?? 0,
    medianFirstResponseMinutes: flow?.medianMinutes ?? null,
    slaTracked: flow?.slaTracked ?? 0,
    slaBreached: flow?.slaBreached ?? 0,
  };
}

export interface ModerationCounts {
  casesByAction: Record<ModAction, number>;
  securityEventsByTrigger: Record<SecurityTrigger, number>;
}

export async function moderationCounts(
  ctx: ServiceContext,
  window: TimeWindow,
): Promise<ModerationCounts> {
  const [cases, events] = await Promise.all([
    ctx.db
      .select({ key: modCases.action, count: count() })
      .from(modCases)
      .where(within(modCases.createdAt, window))
      .groupBy(modCases.action),
    ctx.db
      .select({ key: securityEvents.trigger, count: count() })
      .from(securityEvents)
      .where(within(securityEvents.createdAt, window))
      .groupBy(securityEvents.trigger),
  ]);
  return {
    casesByAction: tally(modAction.enumValues, cases),
    securityEventsByTrigger: tally(securityTrigger.enumValues, events),
  };
}
