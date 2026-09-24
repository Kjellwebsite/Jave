import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  trialEvaluations,
  trialResults,
  trialScores,
  trialSubmissions,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { authorize, can } from '../permissions/authorize';
import { assertNoConflictOfInterest } from './guards';
import { loadParticipantDetails, loadTeams, loadTrial, type ParticipantStatus } from './repository';
import { computeTrialResults } from './results';
import { trialIdSchema } from './schemas';
import type { ComputedResult, TrialOutcome } from './scoring';
import {
  type RubricView,
  toRubricView,
  toSummaryView,
  type TrialSummaryView,
} from './views.shared';
import type { SubmissionView, TeammateView } from './views.service';

export interface StaffParticipantView {
  memberId: string;
  displayName: string;
  handle: string;
  primaryDomain: string | null;
  status: ParticipantStatus;
  teamName: string | null;
  teamRole: 'lead' | 'member' | null;
  statement: string | null;
  appliedAt: Date;
  selectedAt: Date | null;
}

export interface StaffEvaluationView {
  id: string;
  evaluatorUserId: string;
  evaluatorName: string | null;
  /** Null for a team evaluation. */
  memberId: string | null;
  overallScore: number;
  scores: Record<string, number>;
  notes: string | null;
  updatedAt: Date;
}

export interface StaffTeamView {
  id: string;
  name: string;
  ordinal: number;
  discordChannelId: string | null;
  discordRoleId: string | null;
  briefedAt: Date | null;
  archivedAt: Date | null;
  members: TeammateView[];
  /** Every version, newest first. */
  submissions: SubmissionView[];
  evaluations: StaffEvaluationView[];
}

export interface StaffResultView {
  memberId: string;
  teamId: string | null;
  teamScore: number | null;
  individualScore: number | null;
  finalScore: number | null;
  outcome: TrialOutcome;
  facetKey: string | null;
  recommendedRank: string | null;
  rankApplied: boolean;
}

export interface StaffTrialView extends TrialSummaryView {
  brief: string;
  rubric: RubricView[];
  templateId: string | null;
  graceMinutes: number;
  assignmentStrategy: string | null;
  assignmentSeed: string | null;
  cancelReason: string | null;
  announcement: { channelId: string; messageId: string } | null;
  participants: StaffParticipantView[];
  teams: StaffTeamView[];
  /** Published results once completed; a live preview while evaluating; otherwise null. */
  results: { published: boolean; rows: StaffResultView[] } | null;
  /** Present only for viewers who hold canManageAdversarial. */
  adversarialEnabled?: boolean;
}

function fromComputed(result: ComputedResult): StaffResultView {
  return {
    memberId: result.memberId,
    teamId: result.teamId,
    teamScore: result.teamScore,
    individualScore: result.individualScore,
    finalScore: result.finalScore,
    outcome: result.outcome,
    facetKey: result.facetKey,
    recommendedRank: result.recommendedRank,
    rankApplied: false,
  };
}

/**
 * Everything staff need to run and evaluate a trial. Requires canManageTrials
 * or canEvaluateTrials, and no stake in the trial.
 */
export async function getTrialForStaff(
  ctx: ServiceContext,
  input: z.input<typeof trialIdSchema>,
): Promise<StaffTrialView> {
  const { trialId } = parseInput(trialIdSchema, input);
  if (!can(ctx, 'canEvaluateTrials'))
    await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'view its staff record');
  const trial = await loadTrial(ctx, trialId);
  const [participants, teams] = await Promise.all([
    loadParticipantDetails(ctx, trialId),
    loadTeams(ctx, trialId),
  ]);
  const teamIds = teams.map((team) => team.id);
  const [submissions, evaluations] = await Promise.all([
    teamIds.length
      ? ctx.db
          .select()
          .from(trialSubmissions)
          .where(inArray(trialSubmissions.teamId, teamIds))
          .orderBy(desc(trialSubmissions.version))
      : Promise.resolve([]),
    ctx.db
      .select({
        evaluation: trialEvaluations,
        evaluatorName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
      })
      .from(trialEvaluations)
      .leftJoin(users, eq(users.id, trialEvaluations.evaluatorUserId))
      .where(eq(trialEvaluations.trialId, trialId))
      .orderBy(asc(trialEvaluations.createdAt)),
  ]);
  const evaluationIds = evaluations.map((row) => row.evaluation.id);
  const scores = evaluationIds.length
    ? await ctx.db
        .select()
        .from(trialScores)
        .where(inArray(trialScores.evaluationId, evaluationIds))
    : [];
  const scoresByEvaluation = new Map<string, Record<string, number>>();
  for (const score of scores) {
    const bucket = scoresByEvaluation.get(score.evaluationId) ?? {};
    bucket[score.criterionKey] = score.score;
    scoresByEvaluation.set(score.evaluationId, bucket);
  }
  const names = new Map(participants.map((p) => [p.memberId, p.displayName]));
  const teamName = new Map(teams.map((team) => [team.id, team.name]));

  let results: StaffTrialView['results'] = null;
  if (trial.status === 'completed') {
    const rows = await ctx.db.select().from(trialResults).where(eq(trialResults.trialId, trialId));
    results = {
      published: true,
      rows: rows.map((row) => ({
        memberId: row.memberId,
        teamId: row.teamId,
        teamScore: row.teamScore,
        individualScore: row.individualScore,
        finalScore: row.finalScore,
        outcome: row.outcome,
        facetKey: row.facetKey,
        recommendedRank: row.recommendedRank,
        rankApplied: row.rankHistoryId !== null,
      })),
    };
  } else if (trial.status === 'evaluating') {
    const snapshot = await computeTrialResults(ctx, trial);
    results = { published: false, rows: snapshot.results.map(fromComputed) };
  }

  const view: StaffTrialView = {
    ...toSummaryView(trial, ctx.clock.now()),
    brief: trial.brief,
    rubric: toRubricView(trial.rubric),
    templateId: trial.templateId,
    graceMinutes: trial.graceMinutes,
    assignmentStrategy: trial.assignmentStrategy,
    assignmentSeed: trial.assignmentSeed,
    cancelReason: trial.cancelReason,
    announcement:
      trial.announcementChannelId && trial.announcementMessageId
        ? { channelId: trial.announcementChannelId, messageId: trial.announcementMessageId }
        : null,
    participants: participants.map((p) => ({
      memberId: p.memberId,
      displayName: p.displayName,
      handle: p.handle,
      primaryDomain: p.primaryDomain,
      status: p.status,
      teamName: p.teamId ? (teamName.get(p.teamId) ?? null) : null,
      teamRole: p.teamRole,
      statement: p.statement,
      appliedAt: p.appliedAt,
      selectedAt: p.selectedAt,
    })),
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      ordinal: team.ordinal,
      discordChannelId: team.discordChannelId,
      discordRoleId: team.discordRoleId,
      briefedAt: team.briefedAt,
      archivedAt: team.archivedAt,
      members: participants
        .filter((p) => p.teamId === team.id)
        .map((p) => ({
          memberId: p.memberId,
          displayName: p.displayName,
          handle: p.handle,
          role: p.teamRole ?? 'member',
        })),
      submissions: submissions
        .filter((s) => s.teamId === team.id)
        .map((s) => ({
          version: s.version,
          summary: s.summary,
          links: s.links,
          isLate: s.isLate,
          submittedAt: s.submittedAt,
          submittedBy: names.get(s.submittedByMemberId) ?? 'former participant',
        })),
      evaluations: evaluations
        .filter((row) => row.evaluation.teamId === team.id)
        .map((row) => ({
          id: row.evaluation.id,
          evaluatorUserId: row.evaluation.evaluatorUserId,
          evaluatorName: row.evaluatorName,
          memberId: row.evaluation.memberId,
          overallScore: row.evaluation.overallScore,
          scores: scoresByEvaluation.get(row.evaluation.id) ?? {},
          notes: row.evaluation.notes,
          updatedAt: row.evaluation.updatedAt,
        })),
    })),
    results,
  };
  if (can(ctx, 'canManageAdversarial')) view.adversarialEnabled = trial.adversarialEnabled;
  return view;
}
