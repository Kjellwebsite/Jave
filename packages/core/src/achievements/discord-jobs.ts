import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { achievementDefinitions, memberAchievements, members, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { getSettings } from '../settings/settings.service';
import { type AchievementRarity, achievementAnnouncementLine, unlockSummary } from './criteria';
import { requireSystemActor, snowflakeId } from './guards';
import type {
  AchievementDefinitionRecord,
  AwardableMember,
  MemberAchievementRecord,
} from './store';

/**
 * Discord job contracts for achievements. Core cannot call Discord; it
 * enqueues these jobs and the bot (apps/bot) executes them with its worker,
 * which runs every job as a system actor.
 */

/**
 * `discord.achievements.announce` — post a public unlock card.
 *
 * Bot responsibilities:
 *  1. Call `getAchievementAnnouncement(ctx, { memberAchievementId })`. When it
 *     returns null (revoked, unverified, hidden, private profile, or already
 *     announced) complete the job without posting.
 *  2. Post one message in `channelId`: the `line` as the embed title-line,
 *     `description` as body, rarity as the kicker, mentioning the member by
 *     `<@memberDiscordId>` with `allowedMentions: { parse: [] }`. Escape
 *     every text field with the UI kit's `userText()` (definitions are
 *     staff-authored, but still untrusted text).
 *  3. Report the message with `markAchievementAnnounced(ctx, {
 *     memberAchievementId, channelId, messageId })`. When it returns
 *     `{ stored: false }` another attempt already announced: delete the
 *     message just posted.
 *
 * Discord permissions (in `channelId`): View Channel, Send Messages, Embed Links.
 * Failures: missing channel or permission is permanent (dead-letter);
 * rate limits and 5xx retry.
 */
export const DISCORD_ACHIEVEMENT_ANNOUNCE_JOB = 'discord.achievements.announce';

export const achievementAnnouncePayloadSchema = z.object({
  memberAchievementId: z.uuid(),
  channelId: snowflakeId,
});
export type AchievementAnnouncePayload = z.infer<typeof achievementAnnouncePayloadSchema>;

/**
 * `discord.achievements.retract` — delete the unlock card of a revoked award.
 *
 * Bot responsibilities: delete message `messageId` in `channelId`. An unknown
 * message or channel means it is already gone: complete the job. No callback.
 *
 * Discord permissions (in `channelId`): View Channel. Manage Messages is not
 * needed: the bot only ever deletes its own message.
 */
export const DISCORD_ACHIEVEMENT_RETRACT_JOB = 'discord.achievements.retract';

export const achievementRetractPayloadSchema = z.object({
  memberAchievementId: z.uuid(),
  channelId: snowflakeId,
  messageId: snowflakeId,
});
export type AchievementRetractPayload = z.infer<typeof achievementRetractPayloadSchema>;

/**
 * Enqueue the public announcement for a verified award when announcements
 * are enabled, a channel is configured, the definition is public and the
 * member's profile is not staff-only. Returns whether a job was queued.
 */
export async function scheduleAchievementAnnouncement(
  ctx: ServiceContext,
  award: Pick<MemberAchievementRecord, 'id' | 'verification'>,
  definition: Pick<AchievementDefinitionRecord, 'visibility'>,
  member: Pick<AwardableMember, 'profileVisibility'>,
): Promise<boolean> {
  if (award.verification !== 'verified') return false;
  if (definition.visibility !== 'public' || member.profileVisibility === 'staff') return false;
  const [notifications, channels] = await Promise.all([
    getSettings(ctx, 'notifications'),
    getSettings(ctx, 'channels'),
  ]);
  if (!notifications.announceAchievements || !channels.achievements) return false;
  const payload: AchievementAnnouncePayload = {
    memberAchievementId: award.id,
    channelId: channels.achievements,
  };
  const id = await enqueueJob(ctx, DISCORD_ACHIEVEMENT_ANNOUNCE_JOB, payload, {
    dedupeKey: `achievement-announce:${award.id}`,
  });
  return id !== null;
}

/** Enqueue deletion of an award's public card, if it was posted. */
export async function scheduleAchievementRetraction(
  ctx: ServiceContext,
  award: Pick<MemberAchievementRecord, 'id' | 'announcementChannelId' | 'announcementMessageId'>,
): Promise<boolean> {
  if (!award.announcementChannelId || !award.announcementMessageId) return false;
  const payload: AchievementRetractPayload = {
    memberAchievementId: award.id,
    channelId: award.announcementChannelId,
    messageId: award.announcementMessageId,
  };
  const id = await enqueueJob(ctx, DISCORD_ACHIEVEMENT_RETRACT_JOB, payload, {
    dedupeKey: `achievement-retract:${award.id}`,
  });
  return id !== null;
}

export interface AchievementAnnouncement {
  memberAchievementId: string;
  memberDiscordId: string;
  memberDisplayName: string;
  memberHandle: string;
  key: string;
  title: string;
  summary: string;
  description: string;
  rarity: AchievementRarity;
  /** "ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped." */
  line: string;
}

const lookupSchema = z.object({ memberAchievementId: z.uuid() }).strict();

/** Bot: the card to post, or null when the award must not (or no longer) be announced. */
export async function getAchievementAnnouncement(
  ctx: ServiceContext,
  input: z.input<typeof lookupSchema>,
): Promise<AchievementAnnouncement | null> {
  requireSystemActor(ctx);
  const { memberAchievementId } = parseInput(lookupSchema, input);
  const [row] = await ctx.db
    .select({
      award: memberAchievements,
      definition: achievementDefinitions,
      member: members,
      user: users,
    })
    .from(memberAchievements)
    .innerJoin(
      achievementDefinitions,
      eq(achievementDefinitions.key, memberAchievements.achievementKey),
    )
    .innerJoin(members, eq(members.id, memberAchievements.memberId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(memberAchievements.id, memberAchievementId));
  if (!row) return null;
  const { award, definition, member, user } = row;
  const announceable =
    award.revokedAt === null &&
    award.announcementMessageId === null &&
    award.verification === 'verified' &&
    definition.visibility === 'public' &&
    member.deletedAt === null &&
    member.standing !== 'banned' &&
    member.profileVisibility !== 'staff';
  if (!announceable) return null;
  return {
    memberAchievementId: award.id,
    memberDiscordId: user.discordId,
    memberDisplayName: member.displayName,
    memberHandle: member.handle,
    key: definition.key,
    title: definition.title,
    summary: unlockSummary(definition),
    description: definition.description,
    rarity: definition.rarity,
    line: achievementAnnouncementLine(definition),
  };
}

const markAnnouncedSchema = z
  .object({ memberAchievementId: z.uuid(), channelId: snowflakeId, messageId: snowflakeId })
  .strict();

/**
 * Bot callback after posting the card. Idempotent: only the first report is
 * stored. If the award was revoked while the card was being posted, the
 * retraction is queued immediately.
 */
export async function markAchievementAnnounced(
  ctx: ServiceContext,
  input: z.input<typeof markAnnouncedSchema>,
): Promise<{ stored: boolean }> {
  requireSystemActor(ctx);
  const data = parseInput(markAnnouncedSchema, input);
  const [updated] = await ctx.db
    .update(memberAchievements)
    .set({
      announcementChannelId: data.channelId,
      announcementMessageId: data.messageId,
      announcedAt: ctx.clock.now(),
    })
    .where(
      and(
        eq(memberAchievements.id, data.memberAchievementId),
        isNull(memberAchievements.announcementMessageId),
      ),
    )
    .returning();
  if (!updated) return { stored: false };
  if (updated.revokedAt !== null) await scheduleAchievementRetraction(ctx, updated);
  return { stored: true };
}
