import { PermanentJobError, type ServiceContext, tickets } from '@jave/core';
import { DiscordActionError } from '../../../discord/gateway';
import type { BotServices } from '../../../runtime';
import { DISCORD_ERROR } from '../constants';
import { ticketCard } from '../render';

type JobType = tickets.TicketDiscordJobType;

/** Validate a job payload against its contract. A malformed payload never becomes valid. */
export function parsePayload<T extends JobType>(
  type: T,
  payload: unknown,
): tickets.TicketDiscordJobPayload<T> {
  try {
    return tickets.parseTicketDiscordJobPayload(type, payload);
  } catch {
    throw new PermanentJobError(`invalid ${type} payload`);
  }
}

function hasCode(error: unknown, codes: readonly number[]): boolean {
  return error instanceof DiscordActionError && codes.some((code) => code === error.code);
}

/** The thread (or channel) no longer exists on Discord. */
export function isThreadGone(error: unknown): boolean {
  return hasCode(error, [DISCORD_ERROR.unknownChannel]);
}

export function isMessageGone(error: unknown): boolean {
  return hasCode(error, [DISCORD_ERROR.unknownMessage]);
}

function isMemberGone(error: unknown): boolean {
  return hasCode(error, [DISCORD_ERROR.unknownMember, DISCORD_ERROR.unknownUser]);
}

/** Retrying cannot fix a permanent Discord failure: dead-letter it. Anything else retries. */
export function asJobError(error: unknown): never {
  if (error instanceof DiscordActionError && error.permanent) {
    throw new PermanentJobError(error.message);
  }
  throw error;
}

/**
 * Add someone to a ticket thread. A person who left the guild cannot be
 * added and never will be — that is recorded, not retried, and the rest of
 * the job still runs.
 */
export async function addMember(
  services: BotServices,
  ctx: ServiceContext,
  threadId: string,
  discordUserId: string,
): Promise<boolean> {
  try {
    await services.gateway.addThreadMember(threadId, discordUserId);
    return true;
  } catch (error) {
    if (!isMemberGone(error)) throw error;
    ctx.logger.warn({ threadId, discordUserId }, 'ticket thread member not added: not in guild');
    return false;
  }
}

/**
 * Bring the status card to the ticket's current state. If someone deleted the
 * card message, post a fresh one and record it with core (same thread, new card).
 */
export async function syncCard(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  if (card.cardMessageId) {
    try {
      await services.gateway.editMessage(threadId, card.cardMessageId, ticketCard(card));
      return;
    } catch (error) {
      if (!isMessageGone(error)) throw error;
    }
  }
  const sent = await services.gateway.sendMessage(threadId, ticketCard(card));
  await tickets.markThreadCreated(ctx, {
    ticketId: card.ticketId,
    threadId,
    cardMessageId: sent.messageId,
  });
}

/**
 * The ticket's thread was deleted on Discord. Core clears it and, for an
 * active ticket, schedules a fresh thread; that job runs right away.
 */
export async function recoverMissingThread(
  services: BotServices,
  ctx: ServiceContext,
  ticketId: string,
  threadId: string,
): Promise<Record<string, unknown>> {
  const result = await tickets.markThreadMissing(ctx, { ticketId, threadId });
  await services.runJobsNow(ctx.effects.jobIds);
  return { threadMissing: true, ...result };
}
