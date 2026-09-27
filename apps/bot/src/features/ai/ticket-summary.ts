import { ai, type tickets } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';

/**
 * The tickets AI summary extension point on Discord: core's guarded AI path
 * (canUseAI, limits, redaction, untrusted wrapping, ledger) with this
 * process's provider, acting as the member who asked. Usage in a ticket
 * handler: `tickets.summarizeTicket(h.ctx, ticketId, discordTicketSummarizer(h))`.
 * With AI_PROVIDER=disabled it refuses calmly with the AI module's own
 * DisabledError; nothing is stored.
 */
export function discordTicketSummarizer(
  h: Pick<HandlerContext, 'ctx' | 'services'>,
): tickets.TicketSummarizer {
  return ai.ticketSummarizer(h.ctx, h.services.ai, 'discord');
}
