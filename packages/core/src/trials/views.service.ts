import { and, asc, count, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  trialParticipants,
  trialResults,
  trials,
  trialSubmissions,
  trialTeams,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { actorMemberId } from '../permissions/actor';
import { authorize, can, isSelf, requireMember } from '../permissions/authorize';
import { eligibilityProblem, isTrialStaff } from './guards';
import {
  findParticipation,
  loadParticipantDetails,
  loadTeams,
  loadTrial,
  type ParticipantRecord,
  type ParticipantStatus,
  STAKE_STATUSES,
  type TrialRecord,
} from './repository';
import { listTrialsSchema, memberHistorySchema, trialIdSchema } from './schemas';
import type { TrialOutcome } from './scoring';
import { MEMBER_VISIBLE_STATUSES } from './state-machine';
import { type TrialTiming, trialTiming } from './timing';
import {
  type RubricView,
  toRubricView,
  toSummaryView,
  type TrialSummaryView,
} from './views.shared';

const HISTORY_LIMIT = 200;
/** Statuses in which the brief and rubric are unsealed for competitors. */
const UNSEALED_STATUSES = ['active', 'evaluating', 'completed'] as const;

export interface SubmissionView {
  version: number;
  summary: string;
  links: string[];
  isLate: boolean;
  submittedAt: Date;
  submittedBy: string;
}

export interface TeammateView {
  memberId: string;
  displayName: string;
  handle: string;
  role: 'lead' | 'member';
}

export interface ParticipantResultView {
  outcome: TrialOutcome;
  finalScore: number | null;
  teamScore: number | null;
  individualScore: number | null;
  facetKey: string | null;
  recommendedRank: string | null;
  publishedAt: Date;
}

/**
 * What a member sees of a trial. Built from an explicit whitelist: never the
 * adversarial flag or anything adversarial, never evaluator notes, never
 * other teams' work before the trial completes, never other members' results.
 */
export interface ParticipantTrialView extends TrialSummaryView {
  /** Sealed (null) until the trial starts, and only ever shown to competitors. */
  brief: string | null;
  rubric: RubricView[] | null;
  teams: { name: string; memberCount: number }[];
  participation: {
    status: ParticipantStatus;
    statement: string | null;
    appliedAt: Date;
    team: { name: string; role: 'lead' | 'member'; members: TeammateView[] } | null;
  } | null;
  mySubmissions: SubmissionView[];
  /** Latest submission of every other team — only once the trial is completed. */
  otherSubmissions: (SubmissionView & { teamName: string })[];
  result: ParticipantResultView | null;
  canApply: boolean;
  canWithdraw: boolean;
  canSubmit: boolean;
}

async function submissionsFor(
  ctx: ServiceContext,
  teamIds: readonly string[],
  names: ReadonlyMap<string, string>,
): Promise<(SubmissionView & { teamId: string })[]> {
  if (teamIds.length === 0) return [];
  const rows = await ctx.db
    .select()
    .from(trialSubmissions)
    .where(inArray(trialSubmissions.teamId, [...teamIds]))
    .orderBy(desc(trialSubmissions.version));
  return rows.map((row) => ({
    teamId: row.teamId,
    version: row.version,
    summary: row.summary,
    links: row.links,
    isLate: row.isLate,
    submittedAt: row.submittedAt,
    submittedBy: names.get(row.submittedByMemberId) ?? 'former participant',
  }));
}

function isCompetitor(participation: ParticipantRecord | null): boolean {
  return participation?.status === 'selected' && participation.teamId !== null;
}

/** Members see recruiting-and-later trials, and cancelled ones they took part in. */
function visibleToMember(trial: TrialRecord, participation: ParticipantRecord | null): boolean {
  return (
    MEMBER_VISIBLE_STATUSES.includes(trial.status) ||
    (trial.status === 'cancelled' && participation !== null)
  );
}

export async function getTrialForParticipant(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<ParticipantTrialView> {
  const { trialId } = parseInput(trialIdSchema, input);
  const actor = requireMember(ctx);
  await authorize(ctx, 'canViewMembers', { type: 'trial', id: trialId });
  const trial = await loadTrial(ctx, trialId);
  const participation = await findParticipation(ctx, trialId, actor.memberId);
  if (!visibleToMember(trial, participation)) throw new NotFoundError('Trial');

  const now = ctx.clock.now();
  const summary = toSummaryView(trial, now);
  const competing = isCompetitor(participation);
  const unsealed = competing && (UNSEALED_STATUSES as readonly string[]).includes(trial.status);
  const teams = await loadTeams(ctx, trialId);
  const competitors = await loadParticipantDetails(ctx, trialId, ['selected']);
  const names = new Map(competitors.map((c) => [c.memberId, c.displayName]));
  const myTeam = competing ? teams.find((team) => team.id === participation!.teamId) : undefined;

  const submissions = competing
    ? await submissionsFor(
        ctx,
        trial.status === 'completed' ? teams.map((team) => team.id) : myTeam ? [myTeam.id] : [],
        names,
      )
    : [];
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const latestByTeam = new Map<string, SubmissionView & { teamId: string }>();
  for (const submission of submissions)
    if (!latestByTeam.has(submission.teamId)) latestByTeam.set(submission.teamId, submission);

  const [result] = await ctx.db
    .select()
    .from(trialResults)
    .where(and(eq(trialResults.trialId, trialId), eq(trialResults.memberId, actor.memberId)));
  const hasStake = participation !== null && STAKE_STATUSES.includes(participation.status);
  const recruitmentOpen =
    trial.status === 'recruiting' &&
    (!trial.recruitmentClosesAt || trial.recruitmentClosesAt.getTime() > now.getTime());

  return {
    ...summary,
    brief: unsealed ? trial.brief : null,
    rubric: unsealed ? toRubricView(trial.rubric) : null,
    teams: teams.map((team) => ({
      name: team.name,
      memberCount: competitors.filter((c) => c.teamId === team.id).length,
    })),
    participation: participation
      ? {
          status: participation.status,
          statement: participation.statement,
          appliedAt: participation.appliedAt,
          team: myTeam
            ? {
                name: myTeam.name,
                role: participation.teamRole ?? 'member',
                members: competitors
                  .filter((c) => c.teamId === myTeam.id)
                  .map((c) => ({
                    memberId: c.memberId,
                    displayName: c.displayName,
                    handle: c.handle,
                    role: c.teamRole ?? 'member',
                  })),
              }
            : null,
        }
      : null,
    mySubmissions: submissions
      .filter((s) => s.teamId === myTeam?.id)
      .map(({ teamId: _teamId, ...rest }) => rest),
    otherSubmissions:
      trial.status === 'completed'
        ? [...latestByTeam.values()]
            .filter((s) => s.teamId !== myTeam?.id)
            .map(({ teamId, ...rest }) => ({ ...rest, teamName: teamName.get(teamId) ?? '' }))
        : [],
    result: result?.publishedAt
      ? {
          outcome: result.outcome,
          finalScore: result.finalScore,
          teamScore: result.teamScore,
          individualScore: result.individualScore,
          facetKey: result.facetKey,
          recommendedRank: result.recommendedRank,
          publishedAt: result.publishedAt,
        }
      : null,
    canApply:
      recruitmentOpen &&
      !hasStake &&
      trial.createdByUserId !== actor.userId &&
      !(participation?.status === 'withdrawn' && isTrialStaff(ctx)) &&
      eligibilityProblem({
        roles: actor.roles,
        standing: actor.standing,
        guildStatus: 'present',
      }) === null,
    canWithdraw: hasStake && (trial.status === 'recruiting' || trial.status === 'teams_assigned'),
    canSubmit: competing && (summary.timing.phase === 'open' || summary.timing.phase === 'grace'),
  };
}

/** Trials list. Staff see every status; members never see drafts or cancelled trials. */
export async function listTrials(
  ctx: ServiceContext,
  input: z.input<typeof listTrialsSchema> = {},
): Promise<Page<TrialSummaryView>> {
  const q = parseInput(listTrialsSchema, input);
  await authorize(ctx, 'canViewMembers', { type: 'trial' });
  const staff = isTrialStaff(ctx);
  if (!staff && q.status && !MEMBER_VISIBLE_STATUSES.includes(q.status))
    return { items: [], total: 0, limit: q.limit, offset: q.offset };
  const filters: SQL[] = [];
  if (q.status) filters.push(eq(trials.status, q.status));
  else if (!staff) filters.push(inArray(trials.status, [...MEMBER_VISIBLE_STATUSES]));
  if (q.category) filters.push(eq(trials.category, q.category));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(trials)
      .where(where)
      .orderBy(desc(trials.number))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(trials).where(where),
  ]);
  const now = ctx.clock.now();
  return {
    items: rows.map((row) => toSummaryView(row, now)),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export interface TrialHistoryEntry {
  trial: TrialSummaryView;
  status: ParticipantStatus;
  teamName: string | null;
  teamRole: 'lead' | 'member' | null;
  appliedAt: Date;
  /** Published results only. */
  outcome: TrialOutcome | null;
  finalScore: number | null;
  facetKey: string | null;
  recommendedRank: string | null;
  rankApplied: boolean;
}

async function participationHistory(
  ctx: ServiceContext,
  memberId: string,
  statuses?: readonly ParticipantStatus[],
): Promise<TrialHistoryEntry[]> {
  const conditions = [eq(trialParticipants.memberId, memberId), ne(trials.status, 'draft')];
  if (statuses) conditions.push(inArray(trialParticipants.status, [...statuses]));
  const rows = await ctx.db
    .select({
      trial: trials,
      participant: trialParticipants,
      teamName: trialTeams.name,
      result: trialResults,
    })
    .from(trialParticipants)
    .innerJoin(trials, eq(trials.id, trialParticipants.trialId))
    .leftJoin(trialTeams, eq(trialTeams.id, trialParticipants.teamId))
    .leftJoin(
      trialResults,
      and(eq(trialResults.trialId, trials.id), eq(trialResults.memberId, memberId)),
    )
    .where(and(...conditions))
    .orderBy(desc(trials.number), asc(trialParticipants.appliedAt))
    .limit(HISTORY_LIMIT);
  const now = ctx.clock.now();
  return rows.map((row) => {
    const published = row.result?.publishedAt ? row.result : null;
    return {
      trial: toSummaryView(row.trial, now),
      status: row.participant.status,
      teamName: row.teamName,
      teamRole: row.participant.teamRole,
      appliedAt: row.participant.appliedAt,
      outcome: published?.outcome ?? null,
      finalScore: published?.finalScore ?? null,
      facetKey: published?.facetKey ?? null,
      recommendedRank: published?.recommendedRank ?? null,
      rankApplied: Boolean(published?.rankHistoryId),
    };
  });
}

/** Every trial the current member applied to, with published outcomes. */
export async function myTrials(ctx: ServiceContext): Promise<TrialHistoryEntry[]> {
  const actor = requireMember(ctx);
  return participationHistory(ctx, actor.memberId);
}

/** Trials a member competed in. Visible to the member and to staff. */
export async function memberTrialHistory(
  ctx: ServiceContext,
  input: z.input<typeof memberHistorySchema>,
): Promise<TrialHistoryEntry[]> {
  const { memberId } = parseInput(memberHistorySchema, input);
  if (!isSelf(ctx.actor, memberId) && !can(ctx, 'canManageTrials'))
    await authorize(ctx, 'canViewPrivateProfiles', { type: 'member', id: memberId });
  return participationHistory(ctx, memberId, ['selected']);
}

/**
 * Time left on a trial, for countdown surfaces. Members see the trials the
 * member view shows them; trial staff see any.
 */
export async function remainingTime(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<TrialTiming> {
  const { trialId } = parseInput(trialIdSchema, input);
  await authorize(ctx, 'canViewMembers', { type: 'trial', id: trialId });
  const trial = await loadTrial(ctx, trialId);
  if (!isTrialStaff(ctx)) {
    const memberId = actorMemberId(ctx.actor);
    const participation = memberId ? await findParticipation(ctx, trialId, memberId) : null;
    if (!visibleToMember(trial, participation)) throw new NotFoundError('Trial');
  }
  return trialTiming(trial, ctx.clock.now());
}
