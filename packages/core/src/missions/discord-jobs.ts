import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { achievementDefinitions, missions } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { enqueueJob } from '../jobs/queue';
import { getSettings } from '../settings/settings.service';
import { loadCatalog } from '../identity/ranks';
import { requireSystemActor, snowflakeId } from '../achievements/guards';
import {
  formatMissionNumber,
  isPast,
  type MissionStatus,
  type MissionType,
  remainingSlots,
} from './rules';
import { countSlotsTaken, type MissionRecord } from './store';

/**
 * Discord job contracts for missions. Core cannot call Discord; it enqueues
 * these jobs and the bot (apps/bot) executes them with its worker, which runs
 * every job as a system actor.
 */

/** Custom-id namespace of the ACCEPT button: `missions:accept:<missionId>` (≤ 100 chars). */
export const MISSION_ACCEPT_CUSTOM_ID_PREFIX = 'missions:accept';

export function missionAcceptCustomId(missionId: string): string {
  return `${MISSION_ACCEPT_CUSTOM_ID_PREFIX}:${missionId}`;
}

/**
 * `discord.missions.announce` — post the mission card with an ACCEPT button.
 *
 * Bot responsibilities:
 *  1. Call `getMissionCard(ctx, { missionId })`. If it returns null, or the
 *     card is already announced (`announcement !== null`), or `status` is not
 *     `open`, complete the job without posting.
 *  2. Post the card in `channelId` with `allowedMentions: { parse: [] }`.
 *     Escape every text field with the UI kit's `userText()`. Render the
 *     ACCEPT button (custom id `card.acceptCustomId`) only when
 *     `card.acceptEnabled`.
 *  3. Report the message with `markMissionAnnounced(ctx, { missionId,
 *     channelId, messageId })`. When it returns `{ stored: false }` another
 *     attempt already posted: delete the message just posted.
 *
 * ACCEPT button handler: parse the mission id from the custom id and call
 * `selfAssignMission(ctx, { missionId })` as the clicking user (never trust
 * the custom id for authorization — the service re-checks everything). Reply
 * ephemerally.
 *
 * Discord permissions (in `channelId`): View Channel, Send Messages, Embed Links.
 * Failures: missing channel or permission is permanent; rate limits and 5xx retry.
 */
export const DISCORD_MISSION_ANNOUNCE_JOB = 'discord.missions.announce';

export const missionAnnouncePayloadSchema = z.object({
  missionId: z.uuid(),
  channelId: snowflakeId,
});
export type MissionAnnouncePayload = z.infer<typeof missionAnnouncePayloadSchema>;

/**
 * `discord.missions.refresh_card` — re-render an announced card after the
 * mission changed (edited, closed, reopened, archived).
 *
 * Bot responsibilities: call `getMissionCard(ctx, { missionId })`; if it has
 * no `announcement`, complete. Otherwise edit message
 * `announcement.messageId` in `announcement.channelId` to the new card; show
 * the ACCEPT button only when `acceptEnabled` (disabled or removed
 * otherwise). An unknown message means it was deleted: complete. No callback.
 *
 * Discord permissions (in the announcement channel): View Channel, Send
 * Messages, Embed Links (editing its own message needs nothing more).
 */
export const DISCORD_MISSION_REFRESH_CARD_JOB = 'discord.missions.refresh_card';

export const missionRefreshCardPayloadSchema = z.object({ missionId: z.uuid() });
export type MissionRefreshCardPayload = z.infer<typeof missionRefreshCardPayloadSchema>;

/** Longest brief shown on a card; the full brief lives in the dashboard. */
export const CARD_BRIEF_MAX = 1000;
const ELLIPSIS = '…';

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * Queue the announcement of a newly opened mission. The channel is
 * `channels.missions`, falling back to `channels.announcements`; with neither
 * configured nothing is queued. Returns whether a job was queued.
 */
export async function scheduleMissionAnnouncement(
  ctx: ServiceContext,
  mission: Pick<MissionRecord, 'id'>,
): Promise<boolean> {
  const channels = await getSettings(ctx, 'channels');
  const channelId = channels.missions ?? channels.announcements;
  if (!channelId) return false;
  const payload: MissionAnnouncePayload = { missionId: mission.id, channelId };
  const id = await enqueueJob(ctx, DISCORD_MISSION_ANNOUNCE_JOB, payload, {
    dedupeKey: `mission-announce:${mission.id}`,
  });
  return id !== null;
}

/** Queue a card refresh when the mission has a posted card. */
export async function scheduleMissionCardRefresh(
  ctx: ServiceContext,
  mission: Pick<MissionRecord, 'id' | 'announcementMessageId'>,
): Promise<boolean> {
  if (!mission.announcementMessageId) return false;
  const payload: MissionRefreshCardPayload = { missionId: mission.id };
  const id = await enqueueJob(ctx, DISCORD_MISSION_REFRESH_CARD_JOB, payload, {
    dedupeKey: `mission-card:${mission.id}`,
  });
  return id !== null;
}

export interface MissionCard {
  missionId: string;
  /** "M-0042" */
  number: string;
  title: string;
  brief: string;
  type: MissionType;
  status: MissionStatus;
  facetLabel: string | null;
  evidenceRequired: boolean;
  deadlineAt: Date | null;
  durationHours: number | null;
  /** Reward achievement title; hidden achievements show as "HIDDEN ACHIEVEMENT". */
  rewardTitle: string | null;
  rewardNote: string | null;
  slotsLeft: number | null;
  acceptEnabled: boolean;
  acceptCustomId: string;
  announcement: { channelId: string; messageId: string } | null;
}

const HIDDEN_REWARD_TITLE = 'HIDDEN ACHIEVEMENT';
const cardLookupSchema = z.object({ missionId: z.uuid() }).strict();

/** Bot: the public card for a mission, or null for drafts and unknown ids. */
export async function getMissionCard(
  ctx: ServiceContext,
  input: z.input<typeof cardLookupSchema>,
): Promise<MissionCard | null> {
  requireSystemActor(ctx);
  const { missionId } = parseInput(cardLookupSchema, input);
  const [row] = await ctx.db
    .select({ mission: missions, reward: achievementDefinitions })
    .from(missions)
    .leftJoin(achievementDefinitions, eq(achievementDefinitions.key, missions.rewardAchievementKey))
    .where(eq(missions.id, missionId));
  if (!row || row.mission.status === 'draft') return null;
  const { mission, reward } = row;
  const [catalog, taken] = await Promise.all([loadCatalog(ctx), countSlotsTaken(ctx, mission.id)]);
  const slotsLeft = remainingSlots(mission.maxAssignees, taken);
  const now = ctx.clock.now();
  return {
    missionId: mission.id,
    number: formatMissionNumber(mission.number),
    title: mission.title,
    brief: truncate(mission.brief, CARD_BRIEF_MAX),
    type: mission.type,
    status: mission.status,
    facetLabel: catalog.facets.find((facet) => facet.key === mission.facetKey)?.label ?? null,
    evidenceRequired: mission.evidenceRequired,
    deadlineAt: mission.deadlineAt,
    durationHours: mission.durationHours,
    rewardTitle: reward
      ? reward.visibility === 'hidden'
        ? HIDDEN_REWARD_TITLE
        : reward.title.toUpperCase()
      : null,
    rewardNote: mission.rewardNote,
    slotsLeft,
    acceptEnabled:
      mission.status === 'open' &&
      mission.selfAssignable &&
      mission.type !== 'team' &&
      !isPast(mission.deadlineAt, now) &&
      slotsLeft !== 0,
    acceptCustomId: missionAcceptCustomId(mission.id),
    announcement:
      mission.announcementChannelId && mission.announcementMessageId
        ? { channelId: mission.announcementChannelId, messageId: mission.announcementMessageId }
        : null,
  };
}

const markAnnouncedSchema = z
  .object({ missionId: z.uuid(), channelId: snowflakeId, messageId: snowflakeId })
  .strict();

/**
 * Bot callback after posting the card. Idempotent: only the first report is
 * stored. If the mission changed state while the card was being posted, a
 * refresh is queued so the card reflects it.
 */
export async function markMissionAnnounced(
  ctx: ServiceContext,
  input: z.input<typeof markAnnouncedSchema>,
): Promise<{ stored: boolean }> {
  requireSystemActor(ctx);
  const data = parseInput(markAnnouncedSchema, input);
  const [updated] = await ctx.db
    .update(missions)
    .set({ announcementChannelId: data.channelId, announcementMessageId: data.messageId })
    .where(and(eq(missions.id, data.missionId), isNull(missions.announcementMessageId)))
    .returning();
  if (!updated) return { stored: false };
  if (updated.status !== 'open') await scheduleMissionCardRefresh(ctx, updated);
  return { stored: true };
}
