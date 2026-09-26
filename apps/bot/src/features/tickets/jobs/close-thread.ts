import { type JobHandler, PermanentJobError, type ServiceContext, tickets } from '@jave/core';
import { DiscordActionError } from '../../../discord/gateway';
import type { BotServices } from '../../../runtime';
import { DISCORD_REASON, TRANSCRIPT_UPLOAD_MAX_BYTES } from '../constants';
import { archiveCard, closingCard, ticketCard } from '../render';
import { asJobError, isMessageGone, isThreadGone, parsePayload } from './shared';

/**
 * Prefix of the error a failed transcript upload leaves on the job. A retry
 * that sees it knows the thread was already closed and locked, so it does not
 * post a second closing card.
 */
export const TRANSCRIPT_STEP_ERROR = 'transcript upload failed';

type TranscriptFormat = 'html' | 'markdown';
/** HTML first; Markdown when the HTML exceeds the upload limit. */
const FORMATS: readonly TranscriptFormat[] = ['html', 'markdown'];

/** Closing card, final card state (no buttons), then lock + archive — last, as posting unarchives. */
async function closeInDiscord(
  services: BotServices,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  const { gateway } = services;
  await gateway.sendMessage(threadId, closingCard(card));
  if (card.cardMessageId) {
    await gateway
      .editMessage(threadId, card.cardMessageId, ticketCard(card))
      .catch((error: unknown) => {
        if (!isMessageGone(error)) throw error;
      });
  }
  await gateway.setThreadState(
    threadId,
    { locked: true, archived: true },
    `${DISCORD_REASON.closeThread} ${card.reference}`,
  );
}

/**
 * Upload the requester-visible transcript (never internal notes: the archive
 * channel's audience is not guaranteed). Every render is audited by core.
 */
async function uploadTranscript(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  archiveChannelId: string,
): Promise<Record<string, unknown>> {
  for (const format of FORMATS) {
    const transcript = await tickets.renderTranscript(ctx, {
      ticketId: card.ticketId,
      format,
      includeInternal: false,
    });
    if (Buffer.byteLength(transcript.content, 'utf8') > TRANSCRIPT_UPLOAD_MAX_BYTES) continue;
    try {
      const sent = await services.gateway.sendMessage(
        archiveChannelId,
        archiveCard(card, transcript),
      );
      return { uploaded: true, format, messageId: sent.messageId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof DiscordActionError && error.permanent) {
        throw new PermanentJobError(`${TRANSCRIPT_STEP_ERROR}: ${reason}`);
      }
      throw new Error(`${TRANSCRIPT_STEP_ERROR}: ${reason}`);
    }
  }
  ctx.logger.warn({ ticketId: card.ticketId }, 'ticket transcript too large to upload');
  return { uploaded: false, reason: 'too large' };
}

/** discord.tickets.close_thread — see packages/core/src/tickets/discord-jobs.ts. */
export function closeThreadHandler(services: BotServices): JobHandler {
  return async (ctx, raw, job) => {
    const payload = parsePayload(tickets.CLOSE_THREAD_JOB, raw);
    const card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
    if (card.status !== 'closed' && card.status !== 'archived') {
      return { skipped: 'reopened since' };
    }
    if (card.threadId && card.threadId !== payload.threadId)
      return { skipped: 'thread superseded' };

    const threadDone = job.lastError?.startsWith(TRANSCRIPT_STEP_ERROR) ?? false;
    let threadMissing = card.threadId === null;
    if (!threadMissing && !threadDone) {
      try {
        await closeInDiscord(services, card, payload.threadId);
      } catch (error) {
        if (!isThreadGone(error)) return asJobError(error);
        threadMissing = true;
        // A closed ticket is not re-provisioned; core only clears the stale reference.
        await tickets.markThreadMissing(ctx, {
          ticketId: card.ticketId,
          threadId: payload.threadId,
        });
      }
    }
    const archive = payload.archiveChannelId
      ? await uploadTranscript(services, ctx, card, payload.archiveChannelId)
      : { uploaded: false, reason: 'no archive channel' };
    return { threadMissing, archive };
  };
}
