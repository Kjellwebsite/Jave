import { z } from 'zod';
import type { ServiceContext } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import { THREAD_NAME_MAX_LENGTH } from './constants';

/**
 * Discord job contracts for the ticket system.
 *
 * Core cannot call Discord. Each side effect is a `discord.tickets.*` job the
 * bot's worker executes (apps/bot, features/tickets). Every handler MUST:
 *
 * - validate its payload with {@link parseTicketDiscordJobPayload};
 * - build a system-actor context and read the *current* ticket through
 *   `tickets.getTicketCard(ctx, { ticketId })` — jobs can run late or out of
 *   order, so the card (not the payload) is the source of truth for state;
 * - be idempotent (at-least-once delivery) and send every message with
 *   `allowedMentions: { parse: [] }`, rendering user text through `userText()`;
 * - never post staff-only information (internal notes, SLA state, AI summaries,
 *   transfers' reasons) into the thread: the requester is a member of it;
 * - map permanent Discord failures (missing permission, unknown channel) to
 *   `PermanentJobError`; when the thread itself is gone (Unknown Channel), call
 *   `tickets.markThreadMissing(ctx, { ticketId, threadId })` and complete.
 *
 * Suggested component custom IDs: `tickets:claim:<ticketId>`, `tickets:close:<ticketId>`.
 * They route only; the click handler calls the core service as the clicking user.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Retries for Discord side effects (backoff 10 s → 1 h). */
export const TICKET_DISCORD_JOB_MAX_ATTEMPTS = 8;

/**
 * Create the ticket's private thread.
 *
 * Bot responsibilities:
 * 1. `getTicketCard`. If `card.threadId` is already set (a retry after success),
 *    only ensure the opener is a thread member and complete. If the ticket is
 *    archived, complete without creating anything.
 * 2. `createPrivateThread(parentChannelId, { name: threadName, reason })` —
 *    non-invitable private thread under settings.channels.tickets. `threadName`
 *    is already cut to Discord's limit; thread names render neither Markdown
 *    nor mentions, so it is used verbatim.
 * 3. `addThreadMember(threadId, openerDiscordId)`.
 * 4. Post the opening card (panel: reference, subject, category, priority,
 *    status, opening-message excerpt) with CLAIM and CLOSE buttons.
 * 5. Callback: `tickets.markThreadCreated(ctx, { ticketId, threadId, cardMessageId })`,
 *    then run the jobs it enqueued (it schedules a close when the ticket was
 *    closed before its thread existed).
 *
 * Discord permissions (tickets channel): View Channel, Create Private Threads,
 * Send Messages in Threads, Embed Links.
 */
export const OPEN_THREAD_JOB = 'discord.tickets.open_thread';
export const openThreadPayloadSchema = z.object({
  ticketId: z.uuid(),
  parentChannelId: snowflake,
  openerDiscordId: snowflake,
  threadName: z.string().min(1).max(THREAD_NAME_MAX_LENGTH),
});

/**
 * Refresh the status card after a change.
 *
 * Bot responsibilities:
 * 1. `getTicketCard`. No `threadId`/`cardMessageId` yet → complete (the open
 *    job renders current state when it runs).
 * 2. Edit the card message to the current state. CLAIM is shown only while the
 *    ticket is active and unassigned; CLOSE while it is active.
 * 3. `claimed` / `transferred`: `addThreadMember(threadId, assignee.discordId)`
 *    and post one line, e.g. "CLAIMED — <assignee> is handling this ticket."
 * 4. `waiting`: post "WAITING ON YOU — <note>" (`note` is the handler's reason,
 *    written for the requester).
 * 5. `unclaimed`, `priority_changed`, `resumed`: card edit only, no message.
 * 6. `refresh` (sent once the thread exists, when the ticket changed while it was
 *    being created): card edit, and `addThreadMember` for the assignee if any.
 *
 * Callback: none (job completion is the record). Thread gone → `markThreadMissing`.
 *
 * Discord permissions (ticket thread): Send Messages in Threads, Embed Links,
 * Read Message History (to edit its own card).
 */
export const UPDATE_CARD_JOB = 'discord.tickets.update_card';
export const CARD_CHANGES = [
  'claimed',
  'unclaimed',
  'transferred',
  'priority_changed',
  'waiting',
  'resumed',
  'refresh',
] as const;
export type CardChange = (typeof CARD_CHANGES)[number];
export const updateCardPayloadSchema = z.object({
  ticketId: z.uuid(),
  change: z.enum(CARD_CHANGES),
  /** Requester-facing text (the waiting reason); null for every other change. */
  note: z.string().max(1000).nullable(),
});

/**
 * Close the thread and archive the transcript.
 *
 * Bot responsibilities:
 * 1. `getTicketCard`. If the ticket is no longer closed/archived (a reopen
 *    superseded this job), complete without acting.
 * 2. Post the closing card in the thread: reference, closed by, `closeReason`.
 * 3. When `archiveChannelId` is set: `tickets.renderTranscript(ctx, { ticketId,
 *    format: 'html', includeInternal: false })` (audited as a system access) and
 *    upload it to that channel as a file with a short summary card. Never
 *    include internal notes: the archive channel's audience is not guaranteed.
 * 4. `setThreadState(threadId, { locked: true, archived: true })` — last, since
 *    posting into an archived thread unarchives it.
 *
 * Callback: none (job completion is the record). Thread gone → `markThreadMissing`
 * (the transcript upload is still attempted).
 *
 * Discord permissions: Send Messages in Threads, Manage Threads (lock/archive);
 * in the archive channel: View Channel, Send Messages, Embed Links, Attach Files.
 */
export const CLOSE_THREAD_JOB = 'discord.tickets.close_thread';
export const closeThreadPayloadSchema = z.object({
  ticketId: z.uuid(),
  threadId: snowflake,
  /** settings.channels.ticketArchive at close time; null skips the upload. */
  archiveChannelId: snowflake.nullable(),
});

/**
 * Reopen a closed ticket's thread.
 *
 * Bot responsibilities:
 * 1. `getTicketCard`. If the ticket is not active any more, complete without acting.
 * 2. `setThreadState(threadId, { archived: false, locked: false })`.
 * 3. `addThreadMember` for the opener (and the assignee, when set).
 * 4. Post "REOPENED — <reason>" and edit the card to the current state.
 *
 * Callback: none. Thread gone → `markThreadMissing` (core then schedules a new
 * thread for the still-active ticket).
 *
 * Discord permissions: Manage Threads (unarchive/unlock), Send Messages in
 * Threads, Embed Links, Read Message History.
 */
export const REOPEN_THREAD_JOB = 'discord.tickets.reopen_thread';
export const reopenThreadPayloadSchema = z.object({
  ticketId: z.uuid(),
  threadId: snowflake,
  reason: z.string().max(1000),
});

export const TICKET_DISCORD_JOBS = {
  [OPEN_THREAD_JOB]: openThreadPayloadSchema,
  [UPDATE_CARD_JOB]: updateCardPayloadSchema,
  [CLOSE_THREAD_JOB]: closeThreadPayloadSchema,
  [REOPEN_THREAD_JOB]: reopenThreadPayloadSchema,
} as const;

export type TicketDiscordJobType = keyof typeof TICKET_DISCORD_JOBS;
export type TicketDiscordJobPayload<T extends TicketDiscordJobType> = z.infer<
  (typeof TICKET_DISCORD_JOBS)[T]
>;

/** Validate a job payload (bot side). Throws ZodError on a malformed payload. */
export function parseTicketDiscordJobPayload<T extends TicketDiscordJobType>(
  type: T,
  payload: unknown,
): TicketDiscordJobPayload<T> {
  return TICKET_DISCORD_JOBS[type].parse(payload) as TicketDiscordJobPayload<T>;
}

/**
 * Enqueue a ticket Discord job inside the caller's transaction. The payload
 * is validated first, so a contract violation fails the service call instead
 * of dead-lettering in the bot.
 */
export async function enqueueTicketDiscordJob<T extends TicketDiscordJobType>(
  ctx: ServiceContext,
  type: T,
  payload: TicketDiscordJobPayload<T>,
  dedupeKey: string,
): Promise<number | null> {
  const parsed = parseTicketDiscordJobPayload(type, payload);
  return enqueueJob(ctx, type, parsed, {
    dedupeKey,
    maxAttempts: TICKET_DISCORD_JOB_MAX_ATTEMPTS,
  });
}
