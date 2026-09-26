import { type JobHandler, tickets } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { announcement } from '../render';
import {
  addMember,
  asJobError,
  isThreadGone,
  parsePayload,
  recoverMissingThread,
  syncCard,
} from './shared';

/**
 * discord.tickets.update_card — does exactly what core's planCardUpdate allows
 * for the ticket as it is now (jobs run late, out of order and after retries).
 * An empty plan completes without touching Discord.
 */
export function updateCardHandler(services: BotServices): JobHandler {
  return async (ctx, raw) => {
    const payload = parsePayload(tickets.UPDATE_CARD_JOB, raw);
    const card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
    const plan = tickets.planCardUpdate(card, payload);
    const threadId = card.threadId;
    if (!threadId || (!plan.editCard && !plan.addMemberDiscordId && !plan.announce)) {
      return { ...plan, skipped: 'nothing to do' };
    }
    try {
      if (plan.editCard) await syncCard(services, ctx, card, threadId);
      if (plan.addMemberDiscordId) {
        await addMember(services, ctx, threadId, plan.addMemberDiscordId);
      }
      if (plan.announce) await services.gateway.sendMessage(threadId, announcement(plan.announce));
    } catch (error) {
      if (isThreadGone(error)) {
        return recoverMissingThread(services, ctx, card.ticketId, threadId);
      }
      return asJobError(error);
    }
    return plan;
  };
}
