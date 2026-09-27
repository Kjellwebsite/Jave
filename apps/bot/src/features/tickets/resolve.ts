import { can, ForbiddenError, isUuid, tickets, ValidationError } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';

/** The `ticket` option shared by every per-ticket subcommand. */
export const TICKET_OPTION = 'ticket';

const SNOWFLAKE = /^\d{17,20}$/;
/** "42", "#42" or "#0042". */
const TICKET_NUMBER = /^#?(\d{1,9})$/;
const EVERY_STATUS = [...tickets.TICKET_STATUSES];

/** The digits of a typed ticket number ("#0042" → "0042"), or null when the text is not one. */
export function ticketDigits(text: string): string | null {
  return TICKET_NUMBER.exec(text.trim())?.[1] ?? null;
}

/** A typed ticket number ("42", "#0042"), or null when the text is not one. */
export function parseTicketNumber(text: string): number | null {
  const number = Number(ticketDigits(text) ?? 0);
  return number >= 1 ? number : null;
}

/**
 * The ticket with this number, any status, if the caller may see it. Core
 * scopes the lookup (members find only their own), so a number cannot be
 * used to probe other people's tickets.
 */
export async function findTicketByNumber(
  h: HandlerContext,
  number: number,
): Promise<tickets.TicketSummary | null> {
  const page = await tickets.listTickets(h.ctx, { number, status: EVERY_STATUS, limit: 1 });
  return page.items[0] ?? null;
}

/**
 * The ticket a command acts on: the `ticket` option (an autocomplete choice,
 * or a typed number) or, when omitted, the ticket behind the thread the
 * command was used in. Core's lookups answer only for tickets the caller may
 * see, so neither can be used to probe other people's tickets or threads.
 */
export async function resolveTicketId(h: HandlerContext): Promise<string> {
  const chosen = h.interaction.options.string(TICKET_OPTION);
  if (chosen) {
    if (isUuid(chosen)) return chosen;
    const number = parseTicketNumber(chosen);
    const found = number ? await findTicketByNumber(h, number) : null;
    if (!found) throw new ValidationError('Choose a ticket from the list.');
    return found.id;
  }
  const channelId = h.interaction.channelId;
  if (channelId && SNOWFLAKE.test(channelId)) {
    const ticketId = await tickets.getTicketIdForThread(h.ctx, { threadId: channelId });
    if (ticketId) return ticketId;
  }
  throw new ValidationError('Use this inside a ticket thread, or choose a ticket.');
}

/** A ticket id taken from a custom id. Custom ids route only; core authorizes. */
export function ticketIdArg(args: readonly string[]): string {
  const ticketId = args[0];
  if (!ticketId || !isUuid(ticketId)) throw new ValidationError('This control is no longer valid.');
  return ticketId;
}

/**
 * UI gate before a staff modal opens, so nobody types a note that will be
 * refused. Core re-checks everything (including "not your own ticket") on submit.
 */
export function requireHandling(h: HandlerContext): void {
  if (!can(h.ctx, 'canHandleTickets')) {
    throw new ForbiddenError('Handling tickets requires canHandleTickets.');
  }
}
