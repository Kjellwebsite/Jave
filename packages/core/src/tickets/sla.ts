import { MINUTE } from '../kernel/clock';
import type { TicketPriority } from './constants';

export type SlaMinutes = Record<TicketPriority, number>;

/** First-response state of a ticket, derived from its timestamps. */
export type SlaState = 'met' | 'breached' | 'pending' | 'none';

export interface SlaFields {
  slaFirstResponseDueAt: Date | null;
  firstResponseAt: Date | null;
  slaBreachedAt: Date | null;
}

/** First response is due `slaMinutes[priority]` after the ticket was opened. */
export function firstResponseDueAt(
  openedAt: Date,
  priority: TicketPriority,
  slaMinutes: SlaMinutes,
): Date {
  return new Date(openedAt.getTime() + slaMinutes[priority] * MINUTE);
}

/**
 * The first-response outcome a ticket's own timestamps prove:
 * - the deadline (a `Date`): breached — the first response, or the close of a
 *   still-unanswered ticket, came strictly after the deadline;
 * - `null`: not breached — answered on time, closed unanswered before the
 *   deadline, or no target at all;
 * - `undefined`: not decided yet (unanswered and still open). The sweep
 *   records the breach once the deadline has passed.
 *
 * It depends only on when things happened, never on when the sweep ran or
 * when the bot delivered a message, so every writer converges on one value.
 */
export function provenBreach(
  ticket: SlaFields & { closedAt: Date | null },
): Date | null | undefined {
  const dueAt = ticket.slaFirstResponseDueAt;
  if (!dueAt) return null;
  const decidedAt = ticket.firstResponseAt ?? ticket.closedAt;
  if (!decidedAt) return undefined;
  return decidedAt.getTime() > dueAt.getTime() ? dueAt : null;
}

/**
 * slaBreachedAt is the stored outcome and the single source for views, list
 * filters and statistics. A priority change never erases it (the deadline is
 * frozen once breached); only a first response proven on time retracts it.
 */
export function slaState(ticket: SlaFields): SlaState {
  if (ticket.slaBreachedAt) return 'breached';
  if (ticket.firstResponseAt) return 'met';
  if (ticket.slaFirstResponseDueAt) return 'pending';
  return 'none';
}

/** Due strictly in the past and still unanswered. Due exactly now is not yet late. */
export function isOverdue(ticket: SlaFields, now: Date): boolean {
  return (
    !ticket.firstResponseAt &&
    !ticket.slaBreachedAt &&
    ticket.slaFirstResponseDueAt !== null &&
    ticket.slaFirstResponseDueAt.getTime() < now.getTime()
  );
}

const ONE_DECIMAL = 10;

/** Round to one decimal place (durations are reported as e.g. 12.5 minutes). */
export function roundToTenth(value: number): number {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

/** Minutes between two instants, rounded to one decimal. */
export function minutesBetween(from: Date, to: Date): number {
  return roundToTenth((to.getTime() - from.getTime()) / MINUTE);
}
