import { truncate } from '../kernel/redact';
import { THREAD_NAME_MAX_LENGTH, ticketReference, type TicketPriority } from './constants';
import type { TicketNotice } from './records';

/**
 * User-facing copy for ticket notifications. Titles never contain user text
 * (the bot renders titles verbatim); user text goes in bodies, which the bot
 * escapes. Concise, calm, uppercase status words.
 */
const REASON_EXCERPT = 300;

function title(number: number, status: string): string {
  return `TICKET ${ticketReference(number)} — ${status}`;
}

export const ticketCopy = {
  claimed: (number: number, handler: string): TicketNotice => ({
    title: title(number, 'CLAIMED'),
    body: `${handler} is handling your ticket. Replies continue in your ticket thread.`,
  }),
  transferred: (number: number, subject: string): TicketNotice => ({
    title: title(number, 'ASSIGNED TO YOU'),
    body: `You now handle “${truncate(subject, 80)}”.`,
  }),
  unassigned: (number: number): TicketNotice => ({
    title: title(number, 'UNASSIGNED'),
    body: 'A ticket manager removed you as the handler.',
  }),
  waiting: (number: number, reason: string): TicketNotice => ({
    title: title(number, 'WAITING ON YOU'),
    body: truncate(reason, REASON_EXCERPT),
  }),
  closed: (number: number, reason: string): TicketNotice => ({
    title: title(number, 'CLOSED'),
    body: truncate(reason, REASON_EXCERPT),
  }),
  reopened: (number: number, reason: string): TicketNotice => ({
    title: title(number, 'REOPENED'),
    body: truncate(reason, REASON_EXCERPT),
  }),
  opened: (number: number, priority: TicketPriority, subject: string): TicketNotice => ({
    title: title(number, `${priority.toUpperCase()} PRIORITY`),
    body: `New ticket: “${truncate(subject, 80)}”. Unclaimed.`,
  }),
  escalated: (number: number, priority: TicketPriority): TicketNotice => ({
    title: title(number, `ESCALATED TO ${priority.toUpperCase()}`),
    body: 'Priority raised. First-response target recalculated where still open.',
  }),
  slaBreached: (number: number, priority: TicketPriority): TicketNotice => ({
    title: title(number, 'RESPONSE TARGET MISSED'),
    body: `No first response within the ${priority.toUpperCase()} target.`,
  }),
};

/** Thread name: "#0042 · subject", within Discord's 100-character limit. */
export function threadName(number: number, subject: string): string {
  return truncate(`${ticketReference(number)} · ${subject}`, THREAD_NAME_MAX_LENGTH);
}
