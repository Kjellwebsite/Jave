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
 * A breach is permanent once recorded (it is history, not a live flag), so a
 * later priority change cannot erase it from the statistics.
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
