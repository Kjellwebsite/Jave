import { publishEvent } from '../events/bus';
import type { ServiceContext } from '../kernel/context';
import type { TicketRecord } from './access';
import { appendTicketEvent, memberIdForUser } from './records';
import { provenBreach } from './sla';

/**
 * What settled a ticket's first-response outcome:
 * - `sweep`: the deadline passed with no response (recurring SLA sweep);
 * - `response`: a first response was stamped (thread reply or setWaiting);
 * - `close`: an unanswered ticket was closed.
 */
export type SlaDecidedBy = 'sweep' | 'response' | 'close';

export type SlaOutcomeChange = 'breached' | 'retracted' | null;

type SlaOutcomeFields = Pick<
  TicketRecord,
  'slaFirstResponseDueAt' | 'firstResponseAt' | 'slaBreachedAt' | 'closedAt'
>;

/**
 * slaBreachedAt patch that brings the stored outcome in line with what the
 * ticket's timestamps prove (see provenBreach). Pass the ticket as it will be
 * after the caller's own patch. Empty when nothing is proven yet or the
 * stored value already matches.
 */
export function slaBreachPatch(next: SlaOutcomeFields): { slaBreachedAt?: Date | null } {
  const proven = provenBreach(next);
  if (proven === undefined) return {};
  const stored = next.slaBreachedAt?.getTime() ?? null;
  if ((proven?.getTime() ?? null) === stored) return {};
  return { slaBreachedAt: proven };
}

/**
 * Staff timeline entry + 'ticket.sla_breached' for a breach just recorded.
 * Runs inside the caller's transaction; every path that sets slaBreachedAt
 * from null calls it exactly once, so each breach is reported once.
 */
export async function recordSlaBreach(
  ctx: ServiceContext,
  ticket: TicketRecord,
  decidedBy: SlaDecidedBy,
): Promise<void> {
  await appendTicketEvent(ctx, ticket.id, 'sla_breached', {
    priority: ticket.priority,
    dueAt: ticket.slaFirstResponseDueAt?.toISOString() ?? null,
    decidedBy,
  });
  await publishEvent(ctx, {
    type: 'ticket.sla_breached',
    aggregateType: 'ticket',
    aggregateId: ticket.id,
    subjectMemberId: await memberIdForUser(ctx, ticket.openerUserId),
    payload: {
      ticketId: ticket.id,
      number: ticket.number,
      priority: ticket.priority,
      assigned: ticket.assigneeUserId !== null,
      decidedBy,
    },
  });
}

/**
 * A breach recorded earlier (by the sweep, or at close) turned out wrong:
 * the first response was sent on time but reached core late. The breach is
 * withdrawn on the staff timeline and for event consumers that counted it.
 */
async function recordSlaRetraction(ctx: ServiceContext, ticket: TicketRecord): Promise<void> {
  await appendTicketEvent(ctx, ticket.id, 'sla_breach_retracted', {
    dueAt: ticket.slaFirstResponseDueAt?.toISOString() ?? null,
    firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
  });
  await publishEvent(ctx, {
    type: 'ticket.sla_breach_retracted',
    aggregateType: 'ticket',
    aggregateId: ticket.id,
    subjectMemberId: await memberIdForUser(ctx, ticket.openerUserId),
    payload: { ticketId: ticket.id, number: ticket.number, priority: ticket.priority },
  });
}

/**
 * Record the effects of a change to the stored outcome between `before` and
 * `after` (one ticket save, inside the caller's transaction). Staff are not
 * alerted here: a breach decided by a response or a close is already past
 * acting on; only the sweep alerts.
 */
export async function recordSlaOutcome(
  ctx: ServiceContext,
  before: Pick<TicketRecord, 'slaBreachedAt'>,
  after: TicketRecord,
  decidedBy: Exclude<SlaDecidedBy, 'sweep'>,
): Promise<SlaOutcomeChange> {
  if (!before.slaBreachedAt && after.slaBreachedAt) {
    await recordSlaBreach(ctx, after, decidedBy);
    return 'breached';
  }
  if (before.slaBreachedAt && !after.slaBreachedAt) {
    await recordSlaRetraction(ctx, after);
    return 'retracted';
  }
  return null;
}
