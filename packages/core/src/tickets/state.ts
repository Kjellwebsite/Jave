import type { TicketStatus } from './constants';

/**
 * Ticket state machine.
 *
 *   open ──claim/transfer──► claimed ──unclaim──► open
 *   open|claimed ──setWaiting──► waiting ──requester replies / resume──► open|claimed
 *   open|claimed|waiting ──close──► closed ──reopen──► open|claimed
 *   closed ──sweep (archiveAfterDays) / archive──► archived   (final)
 *
 * Assignment is orthogonal to 'waiting': a waiting ticket may or may not have
 * an assignee, and returns to 'claimed' or 'open' accordingly.
 */
export interface AssignmentState {
  status: TicketStatus;
  assigneeUserId: string | null;
}

/** After a claim or transfer: waiting tickets keep waiting on the requester. */
export function assignedStatus(ticket: AssignmentState): TicketStatus {
  return ticket.status === 'waiting' ? 'waiting' : 'claimed';
}

/** After an unclaim. */
export function unassignedStatus(ticket: AssignmentState): TicketStatus {
  return ticket.status === 'waiting' ? 'waiting' : 'open';
}

/** Leaving 'waiting', or reopening: back to whoever holds it. */
export function resumedStatus(ticket: AssignmentState): TicketStatus {
  return ticket.assigneeUserId ? 'claimed' : 'open';
}
