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
import { inOpenThread, isMessageGone, isThreadGone, parsePayload } from './shared';

/**
 * The close runs as three steps. Posting is not idempotent, so a failed run
 * records the step it was in (in the job's error) and the retry resumes
 * there. Every failure inside the handler names its step, including reading
 * the ticket and reporting a deleted thread.
 *
 * A retry that finds no step (the worker died mid-run and its lease was
 * recovered, or the run failed after the handler returned) asks Discord: a
 * locked thread means finalize and lock are done, because the lock comes last
 * in the thread. The one gap: a worker that dies between posting the closing
 * card and locking the thread posts the card again on the retry.
 *
 * - `finalize`: edit the status card to its closed state, then post the closing card;
 * - `lock`: lock and archive the thread (last in the thread: posting unarchives);
 * - `transcript`: upload the requester-visible transcript to the archive channel.
 */
export const CLOSE_STEPS = ['finalize', 'lock', 'transcript'] as const;
export type CloseStep = (typeof CLOSE_STEPS)[number];

const STEP_ERROR_PREFIX = 'close step ';
const STEP_ERROR = /^close step (\w+) failed: /;
/** JaveError codes retrying cannot fix: the worker's own rule. */
const FINAL_ERROR_CODES: readonly string[] = [
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_STATE',
];

/** The error message a failed step leaves on the job (`close step lock failed: …`). */
export function stepErrorMessage(step: CloseStep, reason: string): string {
  return `${STEP_ERROR_PREFIX}${step} failed: ${reason}`;
}

/** The step the last failed run named, if any. */
export function namedStep(job: Pick<JobRecord, 'lastError'>): CloseStep | null {
  const named = job.lastError ? STEP_ERROR.exec(job.lastError)?.[1] : undefined;
  return CLOSE_STEPS.find((step) => step === named) ?? null;
}

/** Where a retry resumes when the last error names a step; the start otherwise. */
export function resumeStep(job: Pick<JobRecord, 'lastError'>): CloseStep {
  return namedStep(job) ?? CLOSE_STEPS[0];
}

function isPermanent(error: unknown): boolean {
  return (
    error instanceof PermanentJobError ||
    (isJaveError(error) && FINAL_ERROR_CODES.includes(error.code)) ||
    (error instanceof DiscordActionError && error.permanent)
  );
}

/**
 * A failure at `step` (or at an unknown point: `null`, so the retry asks
 * Discord again). Permanent failures dead-letter; anything else retries.
 * Exported for tests.
 */
export function failAt(step: CloseStep | null, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  const message = step ? stepErrorMessage(step, reason) : reason;
  if (isPermanent(error)) return new PermanentJobError(message);
  return step || !(error instanceof Error) ? new Error(message) : error;
}

async function runStep<T>(step: CloseStep | null, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw failAt(step, error);
  }
}

/**
 * The status card to its closed state (no buttons), then the closing card.
 * A thread that archived itself while idle is unarchived first.
 */
async function finalize(
  services: BotServices,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  const { gateway } = services;
  const { cardMessageId } = card;
  if (cardMessageId) {
    try {
      await inOpenThread(services, threadId, () =>
        gateway.editMessage(threadId, cardMessageId, ticketCard(card)),
      );
    } catch (error) {
      // A deleted status card is not re-posted: the closing card below says it all.
      if (!isMessageGone(error)) throw error;
    }
  }
  await inOpenThread(services, threadId, () => gateway.sendMessage(threadId, closingCard(card)));
}

async function lock(
  services: BotServices,
  card: tickets.TicketCard,
  threadId: string,
): Promise<void> {
  await inOpenThread(services, threadId, () =>
    services.gateway.setThreadState(
      threadId,
      { locked: true, archived: true },
      `${DISCORD_REASON.closeThread} ${card.reference}`,
    ),
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
 * A retry that finds no step in the last error. The lock is the marker
 * Discord keeps: the thread is locked only after the closing card is posted.
 */
async function unnamedResume(
  services: BotServices,
  job: Pick<JobRecord, 'attempts'>,
  threadId: string,
): Promise<CloseStep> {
  if (job.attempts <= 1) return 'finalize';
  const state = await services.gateway.fetchThreadState(threadId);
  return state.locked ? 'transcript' : 'finalize';
}

/**
 * The thread's part of the close (finalize, lock), resumed where the last
 * run stopped. A deleted thread is reported to core (a closed ticket is not
 * re-provisioned, core only clears the stale reference) and the transcript
 * still goes out.
 */
async function closeThread(
  services: BotServices,
  ctx: ServiceContext,
  card: tickets.TicketCard,
  threadId: string,
  job: Pick<JobRecord, 'attempts' | 'lastError'>,
): Promise<{ from: CloseStep; threadMissing: boolean }> {
  let step = namedStep(job);
  let from: CloseStep = step ?? CLOSE_STEPS[0];
  try {
    if (!step) from = await unnamedResume(services, job, threadId);
    step = from;
    if (step === 'finalize') {
      await finalize(services, card, threadId);
      step = 'lock';
    }
    if (step === 'lock') await lock(services, card, threadId);
    return { from, threadMissing: false };
  } catch (error) {
    if (!isThreadGone(error)) throw failAt(step, error);
    await runStep(step, () =>
      tickets.markThreadMissing(ctx, { ticketId: card.ticketId, threadId }),
    );
    return { from, threadMissing: true };
  }
}

/** discord.tickets.close_thread — see packages/core/src/tickets/discord-jobs.ts. */
export function closeThreadHandler(services: BotServices): JobHandler {
  return async (ctx, raw, job) => {
    const payload = parsePayload(tickets.CLOSE_THREAD_JOB, raw);
    // A failure before any step keeps the resume point the last run left.
    const card = await runStep(namedStep(job), () =>
      tickets.getTicketCard(ctx, { ticketId: payload.ticketId }),
    );
    if (card.status !== 'closed' && card.status !== 'archived') {
      return { skipped: 'reopened since' };
    }
    if (card.threadId && card.threadId !== payload.threadId) {
      return { skipped: 'thread superseded' };
    }

    let from = resumeStep(job);
    let threadMissing = card.threadId === null;
    if (!threadMissing && from !== 'transcript') {
      ({ from, threadMissing } = await closeThread(services, ctx, card, payload.threadId, job));
    }
    const { archiveChannelId } = payload;
    const archive = archiveChannelId
      ? await runStep('transcript', () => uploadTranscript(services, ctx, card, archiveChannelId))
      : { uploaded: false, reason: 'no archive channel' };
    return { threadMissing, resumedAt: from, archive };
  };
}
