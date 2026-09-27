import {
  isJaveError,
  type JobHandler,
  type JobRecord,
  PermanentJobError,
  type ServiceContext,
  tickets,
} from '@jave/core';
import { DiscordActionError } from '../../../discord/gateway';
import type { BotServices } from '../../../runtime';
import { DISCORD_REASON, TRANSCRIPT_UPLOAD_MAX_BYTES } from '../constants';
import { archiveCard, closingCard, ticketCard } from '../render';
import { isMessageGone, isThreadGone, parsePayload } from './shared';

/**
 * The close runs as three steps. Posting is not idempotent, so a failed run
 * records the step it stopped at in its error and the retry resumes there:
 * the closing card is never posted twice, and posting never unarchives a
 * thread that was already locked.
 *
 * - `finalize`: edit the status card to its closed state, then post the closing card;
 * - `lock`: lock and archive the thread (last in the thread: posting unarchives);
 * - `transcript`: upload the requester-visible transcript to the archive channel.
 */
export const CLOSE_STEPS = ['finalize', 'lock', 'transcript'] as const;
export type CloseStep = (typeof CLOSE_STEPS)[number];

const STEP_ERROR_PREFIX = 'close step ';
const STEP_ERROR = /^close step (\w+) failed: /;

/** The error message a failed step leaves on the job (`close step lock failed: …`). */
export function stepErrorMessage(step: CloseStep, reason: string): string {
  return `${STEP_ERROR_PREFIX}${step} failed: ${reason}`;
}

/**
 * Where a retry resumes: the step named in the last error, or the start when
 * the last run left no step (first run, a crash, a recovered lease).
 */
export function resumeStep(job: Pick<JobRecord, 'lastError'>): CloseStep {
  const named = job.lastError ? STEP_ERROR.exec(job.lastError)?.[1] : undefined;
  return CLOSE_STEPS.find((step) => step === named) ?? CLOSE_STEPS[0];
}

/**
 * Retrying cannot fix a permanent Discord failure or a domain refusal: those
 * dead-letter. Anything else retries, resuming at `step`.
 */
function stepFailure(step: CloseStep, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  const message = stepErrorMessage(step, reason);
  const permanent =
    error instanceof PermanentJobError ||
    isJaveError(error) ||
    (error instanceof DiscordActionError && error.permanent);
  return permanent ? new PermanentJobError(message) : new Error(message);
}

async function runStep<T>(step: CloseStep, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw stepFailure(step, error);
  }
}

/** The status card to its closed state (no buttons), then the closing card. */
async function finalize(
  services: BotServices,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  const { gateway } = services;
  if (card.cardMessageId) {
    try {
      await gateway.editMessage(threadId, card.cardMessageId, ticketCard(card));
    } catch (error) {
      // A deleted status card is not re-posted: the closing card below says it all.
      if (!isMessageGone(error)) throw error;
    }
  }
  await gateway.sendMessage(threadId, closingCard(card));
}

async function lock(
  services: BotServices,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  await services.gateway.setThreadState(
    threadId,
    { locked: true, archived: true },
    `${DISCORD_REASON.closeThread} ${card.reference}`,
  );
}

type TranscriptFormat = 'html' | 'markdown';
/** HTML first; Markdown when the HTML exceeds the upload limit. */
const FORMATS: readonly TranscriptFormat[] = ['html', 'markdown'];

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
    const sent = await services.gateway.sendMessage(
      archiveChannelId,
      archiveCard(card, transcript),
    );
    return { uploaded: true, format, messageId: sent.messageId };
  }
  ctx.logger.warn({ ticketId: card.ticketId }, 'ticket transcript too large to upload');
  return { uploaded: false, reason: 'too large' };
}

/**
 * The thread's part of the close (finalize, lock) from `from` on. A deleted
 * thread is reported to core — a closed ticket is not re-provisioned, core
 * only clears the stale reference — and the transcript still goes out.
 */
async function closeThread(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  threadId: string,
  from: CloseStep,
): Promise<boolean> {
  let step: CloseStep = from;
  try {
    if (step === 'finalize') {
      await finalize(services, card, threadId);
      step = 'lock';
    }
    if (step === 'lock') await lock(services, card, threadId);
    return false;
  } catch (error) {
    if (!isThreadGone(error)) throw stepFailure(step, error);
    await tickets.markThreadMissing(ctx, { ticketId: card.ticketId, threadId });
    return true;
  }
}

/** discord.tickets.close_thread — see packages/core/src/tickets/discord-jobs.ts. */
export function closeThreadHandler(services: BotServices): JobHandler {
  return async (ctx, raw, job) => {
    const payload = parsePayload(tickets.CLOSE_THREAD_JOB, raw);
    const card = await tickets.getTicketCard(ctx, { ticketId: payload.ticketId });
    if (card.status !== 'closed' && card.status !== 'archived') {
      return { skipped: 'reopened since' };
    }
    if (card.threadId && card.threadId !== payload.threadId) {
      return { skipped: 'thread superseded' };
    }

    const from = resumeStep(job);
    let threadMissing = card.threadId === null;
    if (!threadMissing && from !== 'transcript') {
      threadMissing = await closeThread(services, ctx, card, payload.threadId, from);
    }
    const archive = payload.archiveChannelId
      ? await runStep('transcript', () =>
          uploadTranscript(services, ctx, card, payload.archiveChannelId!),
        )
      : { uploaded: false, reason: 'no archive channel' };
    return { threadMissing, resumedAt: from, archive };
  };
}
