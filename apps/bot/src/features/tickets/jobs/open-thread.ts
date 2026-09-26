import { ConflictError, type JobHandler, type ServiceContext, tickets } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { DISCORD_REASON } from '../constants';
import { isActiveStatus } from '../labels';
import { ticketCard } from '../render';
import { addMember, asJobError, isThreadGone, parsePayload } from './shared';

type OpenPayload = tickets.TicketDiscordJobPayload<typeof tickets.OPEN_THREAD_JOB>;

/**
 * A thread is already recorded (a retry after success, or a re-run): make sure
 * the opener is in it. If Discord no longer has it, clear it in core and
 * report `null` so this run provisions a fresh one — a re-provision enqueued
 * from inside this job would be deduplicated against the job itself.
 */
async function ensureExisting(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  threadId: string,
  payload: OpenPayload,
): Promise<Record<string, unknown> | null> {
  try {
    const openerAdded = await addMember(services, ctx, threadId, payload.openerDiscordId);
    return { status: 'exists', threadId, openerAdded };
  } catch (error) {
    if (!isThreadGone(error)) return asJobError(error);
    await tickets.markThreadMissing(ctx, { ticketId: card.ticketId, threadId });
    return null;
  }
}

/**
 * Create the private thread, post the card, record both with core, then add
 * the opener. The card goes in before the callback so the thread is never
 * recorded without one; the opener joins after, so a failure there cannot
 * orphan a second thread on retry.
 */
async function createThread(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  payload: OpenPayload,
): Promise<Record<string, unknown>> {
  const { gateway } = services;
  let threadId: string;
  let cardMessageId: string;
  try {
    threadId = await gateway.createPrivateThread(payload.parentChannelId, {
      name: payload.threadName,
      reason: `${DISCORD_REASON.openThread} ${card.reference}`,
    });
    cardMessageId = (await gateway.sendMessage(threadId, ticketCard(card))).messageId;
  } catch (error) {
    return asJobError(error);
  }
  try {
    await tickets.markThreadCreated(ctx, { ticketId: card.ticketId, threadId, cardMessageId });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    // A concurrent run recorded its thread first: remove ours instead of leaving an orphan.
    await gateway
      .deleteChannel(threadId, DISCORD_REASON.duplicateThread)
      .catch((cleanup: unknown) =>
        ctx.logger.warn({ err: cleanup, threadId }, 'duplicate ticket thread not deleted'),
      );
    return { status: 'duplicate', threadId };
  }
  try {
    const openerAdded = await addMember(services, ctx, threadId, payload.openerDiscordId);
    return { status: 'created', threadId, cardMessageId, openerAdded };
  } catch (error) {
    return asJobError(error);
  } finally {
    // markThreadCreated schedules a card refresh (or the close, if the ticket closed meanwhile).
    await services.runJobsNow(ctx.effects.jobIds);
  }
}

/** discord.tickets.open_thread — see packages/core/src/tickets/discord-jobs.ts. */
export function openThreadHandler(services: BotServices): JobHandler {
  return async (ctx, raw) => {
    const payload = parsePayload(tickets.OPEN_THREAD_JOB, raw);
    let card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
    if (card.status === 'archived') return { skipped: 'archived' };
    if (card.threadId) {
      const existing = await ensureExisting(services, ctx, card, card.threadId, payload);
      if (existing) return existing;
      card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
      if (card.threadId) return { skipped: 'thread superseded' };
      if (!isActiveStatus(card.status)) return { skipped: 'thread gone, ticket no longer active' };
    }
    return createThread(services, ctx, card, payload);
  };
}
