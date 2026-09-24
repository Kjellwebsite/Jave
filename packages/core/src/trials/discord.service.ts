import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { trials, trialTeams } from '@jave/database';
import { MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { rolesWithCapability } from '../notifications/notifications.service';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { type TrialCategory, type TrialStatus, trialRef } from './constants';
import { enqueueArchive, enqueueBrief, enqueueProvision } from './effects';
import { assertNoConflictOfInterest, requireSystem } from './guards';
import {
  activeRolesByMember,
  findTeam,
  loadCompetitors,
  loadParticipantDetails,
  loadTeams,
  loadTrial,
  STAKE_STATUSES,
  type TeamRecord,
  type TrialRecord,
} from './repository';
import { announceJobSchema, archiveJobSchema } from './discord-jobs';
import {
  markAnnouncementPostedSchema,
  markTeamProvisionedSchema,
  markTeamsArchivedSchema,
  teamRefSchema,
  trialIdSchema,
  warningSpecSchema,
} from './schemas';
import { assertStatus, TERMINAL_STATUSES } from './state-machine';
import { closeTime, formatDuration, formatRemaining, formatUtc } from './timing';
import { type RubricView, toRubricView } from './views.shared';

/**
 * Spec loaders and callbacks for the Discord job contracts in discord-jobs.ts.
 * All of them are reserved for the bot's worker (system actor).
 */

export interface SkipSpec {
  action: 'skip';
  reason: string;
}

const skip = (reason: string): SkipSpec => ({ action: 'skip', reason });

/** Discord channel names: lowercase, digits and hyphens. */
function channelSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function teamChannelName(trial: TrialRecord, team: TeamRecord): string {
  return channelSlug(`${trialRef(trial)} ${team.name}`);
}

// ─── Recruitment card ────────────────────────────────────────────────────────

export interface AnnouncementCard {
  heading: string;
  kicker: string;
  summary: string;
  facts: { label: string; value: string }[];
  status: TrialStatus;
  acceptingApplications: boolean;
  buttonLabel: string;
}

export type AnnouncementSpec =
  | SkipSpec
  | { action: 'post'; trialId: string; channelId: string; card: AnnouncementCard }
  | {
      action: 'edit';
      trialId: string;
      channelId: string;
      messageId: string;
      card: AnnouncementCard;
    };

const CLOSED_BUTTON_LABEL: Record<TrialStatus, string> = {
  draft: 'NOT OPEN',
  recruiting: 'RECRUITMENT CLOSED',
  teams_assigned: 'RECRUITMENT CLOSED',
  active: 'IN PROGRESS',
  evaluating: 'IN EVALUATION',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

function categoryLabel(category: TrialCategory): string {
  return category.toUpperCase();
}

function announcementCard(trial: TrialRecord, now: Date): AnnouncementCard {
  const accepting =
    trial.status === 'recruiting' &&
    (!trial.recruitmentClosesAt || trial.recruitmentClosesAt.getTime() > now.getTime());
  return {
    heading: `${trialRef(trial)} — ${trial.title.toUpperCase()}`,
    kicker: `TRIAL · ${categoryLabel(trial.category)}`,
    summary: trial.summary,
    facts: [
      { label: 'Team size', value: String(trial.teamSize) },
      { label: 'Duration', value: formatDuration(trial.durationMinutes) },
      {
        label: 'Recruitment',
        value: trial.recruitmentClosesAt
          ? `closes ${formatUtc(trial.recruitmentClosesAt)}`
          : 'open until staff close it',
      },
      ...(trial.maxParticipants ? [{ label: 'Places', value: String(trial.maxParticipants) }] : []),
    ],
    status: trial.status,
    acceptingApplications: accepting,
    buttonLabel: accepting ? 'APPLY' : CLOSED_BUTTON_LABEL[trial.status],
  };
}

export async function getAnnouncementSpec(
  ctx: ServiceContext,
  input: z.input<typeof announceJobSchema>,
): Promise<AnnouncementSpec> {
  requireSystem(ctx);
  const { trialId } = parseInput(announceJobSchema, input);
  const trial = await loadTrial(ctx, trialId);
  if (trial.status === 'draft') return skip('trial is a draft');
  const card = announcementCard(trial, ctx.clock.now());
  if (trial.announcementChannelId && trial.announcementMessageId)
    return {
      action: 'edit',
      trialId,
      channelId: trial.announcementChannelId,
      messageId: trial.announcementMessageId,
      card,
    };
  if (trial.status !== 'recruiting') return skip('recruitment is over and no card was posted');
  const channelId = (await getSettings(ctx, 'channels')).announcements;
  if (!channelId) return skip('channels.announcements is not configured');
  return { action: 'post', trialId, channelId, card };
}

export async function markAnnouncementPosted(
  ctx: ServiceContext,
  input: z.input<typeof markAnnouncementPostedSchema>,
): Promise<void> {
  requireSystem(ctx);
  const data = parseInput(markAnnouncementPostedSchema, input);
  const rows = await ctx.db
    .update(trials)
    .set({ announcementChannelId: data.channelId, announcementMessageId: data.messageId })
    .where(eq(trials.id, data.trialId))
    .returning({ id: trials.id });
  if (rows.length === 0) throw new NotFoundError('Trial');
}

// ─── Team channels ───────────────────────────────────────────────────────────

export type ProvisioningSpec =
  | SkipSpec
  | {
      action: 'ensure';
      trialId: string;
      teamId: string;
      channelName: string;
      topic: string;
      parentCategoryId: string;
      existingChannelId: string | null;
      existingRoleId: string | null;
      createRole: boolean;
      roleName: string;
      /** Team members: full access to the channel (and holders of the team role). */
      memberDiscordIds: string[];
      /** Discord roles mapped from JAVE roles holding canEvaluateTrials. */
      evaluatorRoleIds: string[];
      /** Staff with a stake elsewhere in this trial: explicitly denied. */
      denyDiscordIds: string[];
    };

export async function getTeamProvisioningSpec(
  ctx: ServiceContext,
  input: z.input<typeof teamRefSchema>,
): Promise<ProvisioningSpec> {
  requireSystem(ctx);
  const { teamId } = parseInput(teamRefSchema, input);
  const team = await findTeam(ctx, teamId);
  if (!team) return skip('team no longer exists');
  const trial = await loadTrial(ctx, team.trialId);
  if (TERMINAL_STATUSES.includes(trial.status)) return skip('trial is over');
  const [channels, trialSettings, roleSettings] = await Promise.all([
    getSettings(ctx, 'channels'),
    getSettings(ctx, 'trials'),
    getSettings(ctx, 'roles'),
  ]);
  if (!channels.trialsCategory)
    throw new InvalidStateError(
      'Configure channels.trialsCategory before provisioning trial teams.',
    );

  const evaluatorRoles = rolesWithCapability('canEvaluateTrials');
  const evaluatorRoleIds = [
    ...new Set(
      evaluatorRoles
        .map((role) => roleSettings.discordRoleIds[role])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const stakeholders = await loadParticipantDetails(ctx, trial.id, STAKE_STATUSES);
  const members = stakeholders.filter((p) => p.status === 'selected' && p.teamId === team.id);
  const others = stakeholders.filter((p) => !(p.status === 'selected' && p.teamId === team.id));
  const roles = await activeRolesByMember(
    ctx,
    others.map((p) => p.memberId),
  );
  const denyDiscordIds = others
    .filter((p) => (roles.get(p.memberId) ?? []).some((role) => evaluatorRoles.includes(role)))
    .map((p) => p.discordId);

  return {
    action: 'ensure',
    trialId: trial.id,
    teamId: team.id,
    channelName: teamChannelName(trial, team),
    topic: `${trialRef(trial)} · ${team.name} · private team channel`,
    parentCategoryId: channels.trialsCategory,
    existingChannelId: team.discordChannelId,
    existingRoleId: team.discordRoleId,
    createRole: trialSettings.createTeamRoles,
    roleName: `${trialRef(trial)} ${team.name}`,
    memberDiscordIds: members.map((p) => p.discordId),
    evaluatorRoleIds,
    denyDiscordIds,
  };
}

/**
 * The bot created (or confirmed) a team's channel. Throws NOT_FOUND when the
 * team was reshuffled away meanwhile — the bot then deletes what it created.
 * Briefs the team right away when the trial is already running, and archives
 * it right away when the trial already ended.
 */
export async function markTeamProvisioned(
  ctx: ServiceContext,
  input: z.input<typeof markTeamProvisionedSchema>,
): Promise<void> {
  requireSystem(ctx);
  const data = parseInput(markTeamProvisionedSchema, input);
  await withTransaction(ctx, async (t) => {
    const [team] = await t.db
      .select()
      .from(trialTeams)
      .where(eq(trialTeams.id, data.teamId))
      .for('update');
    if (!team) throw new NotFoundError('Team');
    await t.db
      .update(trialTeams)
      .set({ discordChannelId: data.channelId, discordRoleId: data.roleId })
      .where(eq(trialTeams.id, team.id));
    const trial = await loadTrial(t, team.trialId);
    if (trial.status === 'active' && !team.briefedAt) await enqueueBrief(t, trial.id, team.id);
    // Provisioning raced a cancel/completion: lock the channel that just appeared.
    if (TERMINAL_STATUSES.includes(trial.status)) await enqueueArchive(t, trial.id);
  });
}

export type BriefSpec =
  | SkipSpec
  | { action: 'wait'; reason: string }
  | {
      action: 'post';
      trialId: string;
      teamId: string;
      channelId: string;
      heading: string;
      category: TrialCategory;
      teamName: string;
      brief: string;
      rubric: RubricView[];
      deadlineAt: Date;
      closesAt: Date;
      graceMinutes: number;
      memberDiscordIds: string[];
      leadDiscordId: string | null;
    };

export async function getTeamBriefSpec(
  ctx: ServiceContext,
  input: z.input<typeof teamRefSchema>,
): Promise<BriefSpec> {
  requireSystem(ctx);
  const { teamId } = parseInput(teamRefSchema, input);
  const team = await findTeam(ctx, teamId);
  if (!team) return skip('team no longer exists');
  const trial = await loadTrial(ctx, team.trialId);
  if (trial.status !== 'active' || !trial.deadlineAt) return skip('trial is not active');
  if (team.briefedAt) return skip('team already briefed');
  if (!team.discordChannelId) return { action: 'wait', reason: 'team channel not provisioned yet' };
  const members = (await loadCompetitors(ctx, trial.id)).filter((c) => c.teamId === team.id);
  return {
    action: 'post',
    trialId: trial.id,
    teamId: team.id,
    channelId: team.discordChannelId,
    heading: `${trialRef(trial)} — ${trial.title.toUpperCase()} — ${team.name}`,
    category: trial.category,
    teamName: team.name,
    brief: trial.brief,
    rubric: toRubricView(trial.rubric),
    deadlineAt: trial.deadlineAt,
    closesAt: closeTime(trial.deadlineAt, trial.graceMinutes),
    graceMinutes: trial.graceMinutes,
    memberDiscordIds: members.map((m) => m.discordId),
    leadDiscordId: members.find((m) => m.teamRole === 'lead')?.discordId ?? null,
  };
}

export async function markTeamBriefed(
  ctx: ServiceContext,
  input: z.input<typeof teamRefSchema>,
): Promise<void> {
  requireSystem(ctx);
  const { teamId } = parseInput(teamRefSchema, input);
  await ctx.db
    .update(trialTeams)
    .set({ briefedAt: ctx.clock.now() })
    .where(and(eq(trialTeams.id, teamId), isNull(trialTeams.briefedAt)));
}

export type WarningSpec =
  | SkipSpec
  | {
      action: 'post';
      channelId: string;
      deadlineAt: Date;
      minutesRemaining: number;
      message: string;
    };

export async function getTeamWarningSpec(
  ctx: ServiceContext,
  input: z.input<typeof warningSpecSchema>,
): Promise<WarningSpec> {
  requireSystem(ctx);
  const data = parseInput(warningSpecSchema, input);
  const team = await findTeam(ctx, data.teamId);
  if (!team) return skip('team no longer exists');
  const trial = await loadTrial(ctx, team.trialId);
  if (trial.status !== 'active' || !trial.deadlineAt) return skip('trial is not active');
  if (trial.deadlineAt.toISOString() !== new Date(data.deadlineAt).toISOString())
    return skip('deadline moved');
  if (!team.discordChannelId) return skip('team has no channel');
  const remaining = formatRemaining(data.minutesRemaining * MINUTE);
  return {
    action: 'post',
    channelId: team.discordChannelId,
    deadlineAt: trial.deadlineAt,
    minutesRemaining: data.minutesRemaining,
    message: `${trialRef(trial)} — ${remaining} remain. Deadline ${formatUtc(trial.deadlineAt)}. A resubmission replaces your team's earlier version.`,
  };
}

// ─── Archive ─────────────────────────────────────────────────────────────────

export type ArchiveSpec =
  | SkipSpec
  | {
      action: 'archive';
      trialId: string;
      finalStatus: 'completed' | 'cancelled';
      closingMessage: string;
      teams: {
        teamId: string;
        channelId: string;
        roleId: string | null;
        archivedChannelName: string;
        memberDiscordIds: string[];
      }[];
    };

export async function getArchiveSpec(
  ctx: ServiceContext,
  input: z.input<typeof archiveJobSchema>,
): Promise<ArchiveSpec> {
  requireSystem(ctx);
  const { trialId } = parseInput(archiveJobSchema, input);
  const trial = await loadTrial(ctx, trialId);
  if (trial.status !== 'completed' && trial.status !== 'cancelled')
    return skip('trial is still running');
  const teams = (await loadTeams(ctx, trialId)).filter(
    (team): team is TeamRecord & { discordChannelId: string } =>
      team.discordChannelId !== null && team.archivedAt === null,
  );
  if (teams.length === 0) return skip('no team channels to archive');
  const competitors = await loadCompetitors(ctx, trialId);
  return {
    action: 'archive',
    trialId,
    finalStatus: trial.status,
    closingMessage:
      trial.status === 'completed'
        ? `${trialRef(trial)} COMPLETED — results are published. This channel is now read-only.`
        : `${trialRef(trial)} CANCELLED. This channel is now read-only.`,
    teams: teams.map((team) => ({
      teamId: team.id,
      channelId: team.discordChannelId,
      roleId: team.discordRoleId,
      archivedChannelName: `archived-${teamChannelName(trial, team)}`,
      memberDiscordIds: competitors.filter((c) => c.teamId === team.id).map((c) => c.discordId),
    })),
  };
}

export async function markTeamsArchived(
  ctx: ServiceContext,
  input: z.input<typeof markTeamsArchivedSchema>,
): Promise<number> {
  requireSystem(ctx);
  const data = parseInput(markTeamsArchivedSchema, input);
  if (data.teamIds.length === 0) return 0;
  const rows = await ctx.db
    .update(trialTeams)
    .set({ archivedAt: ctx.clock.now() })
    .where(
      and(
        eq(trialTeams.trialId, data.trialId),
        inArray(trialTeams.id, data.teamIds),
        isNull(trialTeams.archivedAt),
      ),
    )
    .returning({ id: trialTeams.id });
  return rows.length;
}

// ─── Staff tools ─────────────────────────────────────────────────────────────

/**
 * Re-run provisioning for every team (e.g. after configuring the trials
 * category, or after role changes). Provisioning is idempotent.
 */
export async function reprovisionTeams(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<{ enqueued: number }> {
  const { trialId } = parseInput(trialIdSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'provision its channels');
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, trialId, 'share');
    assertStatus(trial, ['teams_assigned', 'active', 'evaluating'], 'provision team channels');
    const teams = await loadTeams(t, trialId);
    for (const team of teams) await enqueueProvision(t, trialId, team.id);
    return { enqueued: teams.length };
  });
}
