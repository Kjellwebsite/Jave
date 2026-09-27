import { type JobHandler, tickets } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { DISCORD_REASON } from '../constants';
import { isActiveStatus } from '../labels';
import { reopenedLine } from '../render';
import {
  addMember,
  asJobError,
  isThreadGone,
  parsePayload,
  recoverMissingThread,
  syncCard,
} from './shared';

/**
 * discord.tickets.reopen_thread — unarchive and unlock first (posting needs
 * an open thread), bring the people back, announce, refresh the card. A
 * deleted thread is reported to core, which provisions a new one.
 */
export function reopenThreadHandler(services: BotServices): JobHandler {
  return async (ctx, raw) => {
    const payload = parsePayload(tickets.REOPEN_THREAD_JOB, raw);
    const card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
    if (!isActiveStatus(card.status)) return { skipped: 'no longer active' };
    if (card.threadId !== payload.threadId) return { skipped: 'thread superseded' };
    const threadId = payload.threadId;
    try {
      await services.gateway.setThreadState(
        threadId,
        { archived: false, locked: false },
        `${DISCORD_REASON.reopenThread} ${card.reference}`,
      );
      for (const person of [card.opener, card.assignee]) {
        if (person) await addMember(services, ctx, threadId, person.discordId);
      }
      await services.gateway.sendMessage(threadId, reopenedLine(payload.reason));
      await syncCard(services, ctx, card, threadId);
    } catch (error) {
      if (isThreadGone(error)) return recoverMissingThread(services, ctx, card.ticketId, threadId);
      return asJobError(error);
    }
    return { reopened: true, threadId };
  };
}
