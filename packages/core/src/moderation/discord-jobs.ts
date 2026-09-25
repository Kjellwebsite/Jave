import { z } from 'zod';
import type { ServiceContext } from '../kernel/context';
import { enqueueJob } from '../jobs/queue';
import {
  DISCORD_AUDIT_REASON_MAX,
  DISCORD_MESSAGE_MAX,
  EVIDENCE_MAX_MESSAGE_IDS,
  MAX_BAN_DELETE_MESSAGE_DAYS,
} from './constants';

/**
 * Discord job contracts for the moderation domain.
 *
 * Core cannot call Discord. Every Discord side effect is a `discord.*` job
 * enqueued in the same transaction as the state change; apps/bot implements
 * the handlers and reports back through the callbacks named below. Handlers
 * must be idempotent (jobs are at-least-once) and must use
 * `allowedMentions: { parse: [] }` and escape user text (`userText()`).
 *
 * Discord permissions the bot needs for moderation (never Administrator):
 * - Moderate Members — timeouts (`member.timeout`).
 * - Kick Members — kicks.
 * - Ban Members — bans / unbans (with message deletion).
 * - Manage Roles — add/remove `settings.roles.quarantineRoleId` and strip
 *   JAVE-managed roles during quarantine. The bot's highest role must sit
 *   above the quarantine role and every managed role.
 * - Manage Messages — delete automod-flagged messages.
 * - View Channel, Send Messages, Embed Links — security alert cards.
 * - View Audit Log (optional) — correlate Discord-native actions.
 * - Manage Server (optional) — raid lockdown: pause invites.
 * Discord also enforces hierarchy: the bot cannot act on the server owner or
 * on members whose highest role is at or above the bot's.
 */

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

/** Seconds per day, for converting ban message-deletion days. */
export const SECONDS_PER_DAY = 86_400;

// ─── discord.moderation.apply ────────────────────────────────────────────────

export const DISCORD_MODERATION_APPLY_JOB = 'discord.moderation.apply';

export const moderationApplyPayloadSchema = z.object({
  caseId: z.uuid(),
  caseNumber: z.number().int().positive(),
  action: z.enum(['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'quarantine', 'release']),
  targetDiscordId: snowflake,
  /** Discord audit-log reason (already truncated to 512). */
  auditReason: z.string().min(1).max(DISCORD_AUDIT_REASON_MAX),
  /** timeout: ISO instant the timeout ends (≤ 28 days out). */
  timeoutUntil: z.iso.datetime().optional(),
  /** ban: seconds of message history to delete (0–7 days). */
  deleteMessageSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_BAN_DELETE_MESSAGE_DAYS * SECONDS_PER_DAY)
    .optional(),
  /** quarantine / release: the configured quarantine role. */
  quarantineRoleId: snowflake.optional(),
  /** quarantine: Discord role IDs JAVE manages, to strip while quarantined. */
  managedRoleIds: z.array(snowflake).max(50).optional(),
  /** Plain text DM to send the target (escape before sending). Warn: required. */
  dmText: z.string().min(1).max(DISCORD_MESSAGE_MAX).optional(),
});
export type ModerationApplyPayload = z.infer<typeof moderationApplyPayloadSchema>;

/**
 * `discord.moderation.apply` — apply one moderation case in Discord.
 *
 * The bot must, by `action`:
 * - warn: DM `dmText` to the target. Closed DMs → report `failed` ("DMs closed").
 * - timeout: best-effort DM `dmText`, then `member.timeout(until = timeoutUntil, auditReason)`.
 *   Needs Moderate Members.
 * - untimeout: `member.timeout(null, auditReason)`. Needs Moderate Members.
 * - kick: best-effort DM `dmText` first (after the kick there is no shared server),
 *   then kick with `auditReason`. Needs Kick Members.
 * - ban: best-effort DM `dmText` first, then ban with `deleteMessageSeconds` and
 *   `auditReason`. Works for users not in the server. Needs Ban Members.
 * - unban: unban with `auditReason`. "Unknown Ban" counts as applied. Needs Ban Members.
 * - quarantine: best-effort DM `dmText`, add `quarantineRoleId`, remove every
 *   `managedRoleIds` role the member holds. Needs Manage Roles.
 * - release: remove `quarantineRoleId`. Managed roles are restored by the
 *   `discord.roles.sync` job core enqueues alongside. Needs Manage Roles.
 *
 * Then call `moderation.markCaseSynced(ctx, { caseId, status: 'applied' | 'failed', error })`.
 * Missing permissions / hierarchy / unknown member are permanent failures:
 * report `failed` with Discord's message and complete the job (do not retry).
 * Transient errors: throw so the job retries; report `failed` on the last attempt.
 */
export const moderationApplyContract = {
  type: DISCORD_MODERATION_APPLY_JOB,
  payload: moderationApplyPayloadSchema,
  callback: 'markCaseSynced',
} as const;

// ─── discord.moderation.alert ────────────────────────────────────────────────

export const DISCORD_MODERATION_ALERT_JOB = 'discord.moderation.alert';

export const moderationAlertPayloadSchema = z.object({
  securityEventId: z.uuid(),
  /** `post`: create the card. `update`: edit the existing card after a review. */
  mode: z.enum(['post', 'update']),
  /** settings.channels.securityAlerts at enqueue time. */
  channelId: snowflake,
  /** update only: the card to edit. */
  messageId: snowflake.optional(),
});
export type ModerationAlertPayload = z.infer<typeof moderationAlertPayloadSchema>;

/**
 * `discord.moderation.alert` — post or refresh a security-event card in
 * `settings.channels.securityAlerts`.
 *
 * The bot must load the card with `moderation.getSecurityAlertCard(ctx, id)`
 * (always the current state), render it as a staff-only embed, and:
 * - post: send it with buttons ACKNOWLEDGE / DISMISS / QUARANTINE while the
 *   event is open (suggested custom IDs `mod:sec:ack:<id>`, `mod:sec:dismiss:<id>`,
 *   `mod:sec:quarantine:<id>`), then call
 *   `moderation.markSecurityAlertPosted(ctx, { securityEventId, channelId, messageId })`.
 * - update: edit `messageId`; remove the buttons once the event is reviewed.
 * Button handlers never trust the custom ID: they call `reviewSecurityEvent` /
 * `quarantineMember({ securityEventId })` as the clicking user, which re-checks
 * capabilities and hierarchy. Needs View Channel, Send Messages, Embed Links.
 */
export const moderationAlertContract = {
  type: DISCORD_MODERATION_ALERT_JOB,
  payload: moderationAlertPayloadSchema,
  callback: 'markSecurityAlertPosted',
} as const;

// ─── discord.moderation.delete_messages ─────────────────────────────────────

export const DISCORD_MODERATION_DELETE_MESSAGES_JOB = 'discord.moderation.delete_messages';

export const moderationDeleteMessagesPayloadSchema = z.object({
  channelId: snowflake,
  messageIds: z.array(snowflake).min(1).max(EVIDENCE_MAX_MESSAGE_IDS),
  auditReason: z.string().min(1).max(DISCORD_AUDIT_REASON_MAX),
  securityEventId: z.uuid().optional(),
});
export type ModerationDeleteMessagesPayload = z.infer<typeof moderationDeleteMessagesPayloadSchema>;

/**
 * `discord.moderation.delete_messages` — delete automod-flagged messages.
 *
 * The bot must delete `messageIds` in `channelId` (bulk delete when more than
 * one and all are younger than 14 days, otherwise one by one). "Unknown
 * Message" counts as success. Needs Manage Messages. No callback: the job's
 * completion is the record.
 */
export const moderationDeleteMessagesContract = {
  type: DISCORD_MODERATION_DELETE_MESSAGES_JOB,
  payload: moderationDeleteMessagesPayloadSchema,
  callback: null,
} as const;

// ─── discord.moderation.lockdown ─────────────────────────────────────────────

export const DISCORD_MODERATION_LOCKDOWN_JOB = 'discord.moderation.lockdown';

export const moderationLockdownPayloadSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(1).max(DISCORD_AUDIT_REASON_MAX),
  /** settings.channels.securityAlerts (or staffAlerts) for the notice, if configured. */
  noticeChannelId: snowflake.optional(),
});
export type ModerationLockdownPayload = z.infer<typeof moderationLockdownPayloadSchema>;

/**
 * `discord.moderation.lockdown` — optional Discord-side raid posture.
 *
 * JAVE already enforces raid mode itself (new joins are quarantined by
 * `screenJoin`). This job lets the bot mirror it in Discord. The bot must
 * converge to the *current* `settings.security.raidMode` (not the payload
 * flag, which may be stale) and may:
 * - post a short notice in `noticeChannelId`;
 * - pause guild invites while raid mode is on (Manage Server — optional).
 * No callback. If the optional permission is missing, post the notice only.
 */
export const moderationLockdownContract = {
  type: DISCORD_MODERATION_LOCKDOWN_JOB,
  payload: moderationLockdownPayloadSchema,
  callback: null,
} as const;

export const DISCORD_JOB_CONTRACTS = [
  moderationApplyContract,
  moderationAlertContract,
  moderationDeleteMessagesContract,
  moderationLockdownContract,
] as const;

/** Validate a payload against its contract, then enqueue it in the caller's transaction. */
export async function enqueueDiscordJob<S extends z.ZodType>(
  ctx: ServiceContext,
  contract: { type: string; payload: S },
  payload: z.input<S>,
  options: { dedupeKey?: string; maxAttempts?: number } = {},
): Promise<number | null> {
  const data = contract.payload.parse(payload) as Record<string, unknown>;
  return enqueueJob(ctx, contract.type, data, options);
}
