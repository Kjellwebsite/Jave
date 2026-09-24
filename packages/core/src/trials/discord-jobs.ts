import { z } from 'zod';
import { LIMITS } from './constants';
import { snowflakeSchema } from './schemas';

/**
 * Discord job contracts for the trials domain.
 *
 * Core services enqueue these jobs inside the same transaction as the state
 * change; the bot's worker (system actor) executes them. Every handler:
 *
 * - parses the payload with the schema below (failure → PermanentJobError),
 * - loads what it needs through the named spec loader instead of trusting
 *   stale payload data (loaders are pure reads, system-actor only),
 * - is idempotent: running twice leaves Discord in the same state,
 * - renders user-provided text with `userText()` and sends every message with
 *   `allowedMentions: { parse: [] }`,
 * - normalizes Discord failures: `DiscordActionError.permanent` →
 *   `PermanentJobError`, anything else is rethrown to retry,
 * - reports results through the named callback (system actor).
 *
 * Discord permissions (least privilege, all scoped to the trials category
 * unless stated): View Channel, Send Messages, Embed Links, Read Message
 * History, Manage Channels; Manage Roles only when `settings.trials.createTeamRoles`
 * is on. Staff who take part in a trial must not hold Administrator, which
 * bypasses channel overwrites.
 */

/**
 * Post — or edit, when one exists — the recruitment card for a trial.
 *
 * Bot: call `trials.getAnnouncementSpec(ctx, { trialId })`.
 * - `action: 'skip'` → complete the job, nothing to do.
 * - `action: 'post'` → send the card to `spec.channelId`; then call
 *   `trials.markAnnouncementPosted(ctx, { trialId, channelId, messageId })`.
 * - `action: 'edit'` → edit `spec.messageId` in `spec.channelId` with the card.
 *   If the message no longer exists, post a new one and report it as above.
 *
 * Card: `panel()` titled `spec.card.heading`, kicker `spec.card.kicker`, body
 * `spec.card.summary`, fields from `spec.card.facts`. When
 * `spec.card.acceptingApplications` is true, add an APPLY button that opens a
 * statement modal and calls `trials.applyToTrial`; otherwise render the
 * button disabled with the label `spec.card.buttonLabel`.
 *
 * Discord permissions: View Channel, Send Messages, Embed Links, Read Message
 * History in the announcements channel.
 */
export const DISCORD_TRIALS_ANNOUNCE_JOB = 'discord.trials.announce';
export const announceJobSchema = z.object({ trialId: z.uuid() });

/**
 * Ensure the private channel (and optional role) of one team matches JAVE.
 *
 * Bot: call `trials.getTeamProvisioningSpec(ctx, { teamId })`.
 * - `action: 'skip'` → complete the job.
 * - `action: 'ensure'`:
 *   1. If `spec.createRole` and no `spec.existingRoleId`: create a role named
 *      `spec.roleName` (no permissions, not hoisted, not mentionable) and add it
 *      to every `spec.memberDiscordIds`. If a role exists, make its holders equal
 *      `spec.memberDiscordIds`.
 *   2. If `spec.existingChannelId` is null: create a text channel
 *      `spec.channelName` under `spec.parentCategoryId` with topic
 *      `spec.topic`; otherwise keep the channel.
 *   3. Set the channel's overwrites to exactly:
 *      - @everyone (guild id): deny ViewChannel;
 *      - each `spec.memberDiscordIds`: allow ViewChannel, SendMessages,
 *        ReadMessageHistory, AttachFiles, EmbedLinks, AddReactions;
 *      - each `spec.evaluatorRoleIds`: allow ViewChannel, ReadMessageHistory,
 *        SendMessages;
 *      - each `spec.denyDiscordIds` (staff competing on another team): deny ViewChannel.
 *   4. Call `trials.markTeamProvisioned(ctx, { teamId, channelId, roleId })`.
 *      If that throws NOT_FOUND (the team was reshuffled away meanwhile),
 *      delete the channel and role just created and complete the job.
 * - `getTeamProvisioningSpec` throws INVALID_STATE when
 *   `settings.channels.trialsCategory` is not configured: the job dead-letters
 *   and staff re-run `trials.reprovisionTeams` after configuring it.
 *
 * Discord permissions: Manage Channels and View Channel in the trials
 * category; Manage Roles only when team roles are enabled (the bot's role must
 * sit above the team roles).
 */
export const DISCORD_TRIALS_PROVISION_JOB = 'discord.trials.provision';
export const provisionJobSchema = z.object({ trialId: z.uuid(), teamId: z.uuid() });

/**
 * Post the mission brief in one team channel when the trial starts.
 *
 * Bot: call `trials.getTeamBriefSpec(ctx, { teamId })`.
 * - `action: 'skip'` → complete the job (already briefed, or trial not active).
 * - `action: 'wait'` → throw a retryable error (the channel is still being provisioned).
 * - `action: 'post'` → send to `spec.channelId`: a panel titled `spec.heading`,
 *   the brief (`userText(spec.brief)`, split across embeds if needed), the
 *   rubric (label, weight percent, description), and the deadline as a Discord
 *   timestamp `<t:unix:F>` plus `<t:unix:R>`. Pin it if the bot may manage
 *   messages; otherwise do not. Then call `trials.markTeamBriefed(ctx, { teamId })`.
 *
 * Discord permissions: View Channel, Send Messages, Embed Links in the team channel.
 */
export const DISCORD_TRIALS_BRIEF_JOB = 'discord.trials.brief';
export const briefJobSchema = z.object({ trialId: z.uuid(), teamId: z.uuid() });

/**
 * Post a time-remaining warning in one team channel.
 *
 * Bot: call `trials.getTeamWarningSpec(ctx, { teamId, minutesRemaining, deadlineAt })`.
 * - `action: 'skip'` → complete the job (trial closed, deadline moved, or no channel).
 * - `action: 'post'` → send `spec.message` to `spec.channelId` with the deadline
 *   as a Discord timestamp. No callback.
 *
 * Discord permissions: View Channel, Send Messages in the team channel.
 */
export const DISCORD_TRIALS_WARNING_JOB = 'discord.trials.warning';
export const warningJobSchema = z.object({
  trialId: z.uuid(),
  teamId: z.uuid(),
  minutesRemaining: z.number().int().min(1),
  deadlineAt: z.iso.datetime(),
});

/**
 * Lock the team channels of a trial that completed or was cancelled.
 *
 * Bot: call `trials.getArchiveSpec(ctx, { trialId })`. For each `spec.teams[i]`:
 * rewrite each member overwrite to allow ViewChannel + ReadMessageHistory and
 * deny SendMessages/AddReactions; post `spec.closingMessage`; rename the channel
 * to `spec.teams[i].archivedChannelName`; delete the team role if
 * `roleId` is set. Then call `trials.markTeamsArchived(ctx, { trialId, teamIds })`
 * with the teams handled. Channels are kept (read-only) as the trial record.
 * (The recruitment card is finalized separately by a `discord.trials.announce` job.)
 *
 * Discord permissions: Manage Channels in the trials category; Manage Roles
 * when team roles were created.
 */
export const DISCORD_TRIALS_ARCHIVE_JOB = 'discord.trials.archive';
export const archiveJobSchema = z.object({ trialId: z.uuid() });

/**
 * Delete Discord resources of a team that no longer exists in JAVE (teams were
 * reshuffled before the start). The payload is self-contained because the team
 * row is gone.
 *
 * Bot: delete `channelId` (if set) and `roleId` (if set). Unknown channel/role
 * counts as success. No callback.
 *
 * Discord permissions: Manage Channels in the trials category; Manage Roles
 * when team roles were created.
 */
export const DISCORD_TRIALS_TEARDOWN_JOB = 'discord.trials.teardown';
export const teardownJobSchema = z.object({
  trialId: z.uuid(),
  teamName: z.string().max(LIMITS.teamName),
  channelId: snowflakeSchema.nullable(),
  roleId: snowflakeSchema.nullable(),
});

/** Every Discord job type this module enqueues. */
export const DISCORD_TRIAL_JOB_TYPES = [
  DISCORD_TRIALS_ANNOUNCE_JOB,
  DISCORD_TRIALS_PROVISION_JOB,
  DISCORD_TRIALS_BRIEF_JOB,
  DISCORD_TRIALS_WARNING_JOB,
  DISCORD_TRIALS_ARCHIVE_JOB,
  DISCORD_TRIALS_TEARDOWN_JOB,
] as const;
