import { z } from 'zod';

/**
 * Discord job contracts for the adversarial module.
 *
 * Core cannot talk to Discord. These jobs are enqueued inside the same
 * transaction as the state change; the bot's worker (system actor) executes
 * them and reports back through the callbacks in `delivery.service.ts`.
 *
 * Rules for every handler:
 * - Validate the payload with the schema below; a bad payload is permanent.
 * - Load content through the named loader — never render from the payload.
 *   A loader throwing a non-retryable JaveError (INVALID_STATE, NOT_FOUND)
 *   means "do not send": finish the job as permanent, send nothing.
 * - Send with `allowedMentions: { parse: [] }` and escape all text with
 *   `userText()`; staff-authored text is never trusted markup.
 * - Report the outcome through the callback, including `undeliverable` when
 *   Discord refuses (closed DMs, missing channel). Callbacks are idempotent.
 */

/**
 * DM the operative their confidential briefing.
 *
 * Bot must:
 * 1. `loadBriefingDelivery(ctx, { roleId, revision })` with the payload's revision →
 *    `{ operativeDiscordId, revision, superseded, alreadyDelivered, briefing, text }`.
 *    Send nothing and finish the job when `superseded` (the job for the newer revision
 *    delivers it — jobs may run concurrently) or `alreadyDelivered` (a retried job).
 * 2. `gateway.sendDirectMessage(operativeDiscordId, …)` rendering every section of
 *    `briefing` — scenario, objective, sandbox assets, triggers, guardrails,
 *    operating rules and the stop-word protocol. Never drop the guardrails or the
 *    stop protocol. Never post the briefing in a guild channel.
 * 3. `markBriefingDelivered(ctx, { roleId, revision, outcome })` with
 *    `outcome: 'undeliverable'` when DMs are closed (gateway returns null).
 *
 * Discord permissions: none in the guild — the bot only needs to share the guild
 * with the operative so it can open a DM.
 */
export const ADVERSARIAL_BRIEF_JOB = 'discord.adversarial.brief';
export const adversarialBriefPayloadSchema = z.object({
  roleId: z.uuid(),
  revision: z.number().int().min(1),
});
export type AdversarialBriefPayload = z.infer<typeof adversarialBriefPayloadSchema>;

/**
 * DM the operative an immediate STOP (abort, RED FLAG, kill switch, trial end).
 *
 * Bot must:
 * 1. `loadStopNotice(ctx, { roleId })` → `{ operativeDiscordId, title, body, alreadyDelivered }`.
 *    Skip when `alreadyDelivered`.
 * 2. `gateway.sendDirectMessage(operativeDiscordId, …)` with the title and body verbatim.
 *    The notice never contains the abort reason (staff-internal).
 * 3. `markStopNoticeDelivered(ctx, { roleId, outcome })`. On `undeliverable`, core
 *    raises a critical staff alert so a human contacts the operative directly.
 *
 * Retries: transient Discord failures should throw so the job retries (it is
 * enqueued with a high attempt budget). Discord permissions: none in the guild.
 */
export const ADVERSARIAL_ABORT_JOB = 'discord.adversarial.abort';
export const adversarialAbortPayloadSchema = z.object({ roleId: z.uuid() });
export type AdversarialAbortPayload = z.infer<typeof adversarialAbortPayloadSchema>;

/**
 * Post the debrief in the team's channel after the reveal (transparency).
 *
 * Bot must:
 * 1. `loadDebrief(ctx, { roleId })` → `{ channelId, alreadyPosted, debrief, text }`.
 *    Skip when `alreadyPosted`. When `channelId` is null (team channel gone), call
 *    `markDebriefPosted(ctx, { roleId, outcome: 'undeliverable' })` — participants
 *    already received the debrief as a notification.
 * 2. `gateway.sendMessage(channelId, …)` rendering `debrief` (title, disclosure,
 *    scenario, operative, score, aggregated outcomes, debrief text). The debrief
 *    never names individual participants; do not add names.
 * 3. `markDebriefPosted(ctx, { roleId, outcome: 'sent', channelId, messageId })`.
 *
 * Discord permissions in the team channel: ViewChannel, SendMessages, EmbedLinks.
 */
export const ADVERSARIAL_DEBRIEF_JOB = 'discord.adversarial.debrief';
export const adversarialDebriefPayloadSchema = z.object({ roleId: z.uuid() });
export type AdversarialDebriefPayload = z.infer<typeof adversarialDebriefPayloadSchema>;

/** Attempt budgets: a STOP must get through; briefings and debriefs are less urgent. */
export const BRIEF_MAX_ATTEMPTS = 8;
export const ABORT_MAX_ATTEMPTS = 12;
export const DEBRIEF_MAX_ATTEMPTS = 8;

export const ADVERSARIAL_DISCORD_JOB_TYPES = [
  ADVERSARIAL_BRIEF_JOB,
  ADVERSARIAL_ABORT_JOB,
  ADVERSARIAL_DEBRIEF_JOB,
] as const;

export const briefJobKey = (roleId: string, revision: number) =>
  `adversarial:brief:${roleId}:${revision}`;
export const abortJobKey = (roleId: string) => `adversarial:abort:${roleId}`;
export const debriefJobKey = (roleId: string) => `adversarial:debrief:${roleId}`;
