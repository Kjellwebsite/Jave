import { can, ForbiddenError, isUuid, tickets, ValidationError } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';

/** The `ticket` option shared by every per-ticket subcommand. */
export const TICKET_OPTION = 'ticket';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * The ticket a command acts on: the `ticket` option (from autocomplete) or,
 * when omitted, the ticket behind the thread the command was used in. Core's
 * thread lookup answers only for tickets the caller may see, so this cannot
 * be used to probe other people's threads.
 */
export async function resolveTicketId(h: HandlerContext): Promise<string> {
  const chosen = h.interaction.options.string(TICKET_OPTION);
  if (chosen) {
    if (!isUuid(chosen)) throw new ValidationError('Choose a ticket from the list.');
    return chosen;
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
