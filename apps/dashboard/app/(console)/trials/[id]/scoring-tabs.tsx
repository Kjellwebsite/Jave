import { can, type loadCatalog, trials } from '@jave/core';
import { type EvaluationTeam, EvaluationPanel } from '@/components/trials/evaluation-panel';
import { type ResultRowData, ResultsPanel } from '@/components/trials/results-panel';
import type { OutcomeKey } from '@/lib/trial-labels';
import { formatTimestamp } from '@/lib/time';
import { scoreTargets } from '@/lib/trial-scoring';
import type { UserContext } from '@/server/context';
import type { Viewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { applyRankAction, evaluateAction, publishResultsAction } from './actions';

type StaffView = trials.StaffTrialView;
type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

const EMPTY_COUNTS: Record<OutcomeKey, number> = {
  distinction: 0,
  pass: 0,
  fail: 0,
  incomplete: 0,
};

function scoringClosedReason(status: trials.TrialStatus): string | null {
  if (status === 'evaluating') return null;
  if (status === 'completed' || status === 'cancelled')
    return 'Scoring is closed: results are final. Evaluations stay here as the record.';
  return 'Scoring opens when submissions close.';
}

export function EvaluationTab({
  ctx,
  view,
  viewer,
}: {
  ctx: UserContext;
  view: StaffView;
  viewer: Viewer;
}) {
  const names = new Map(view.participants.map((p) => [p.memberId, p.displayName]));
  const teamScore = new Map<string, number | null>();
  for (const row of view.results?.rows ?? [])
    if (row.teamId && !teamScore.has(row.teamId)) teamScore.set(row.teamId, row.teamScore);

  const teams: EvaluationTeam[] = view.teams.map((team) => ({
    id: team.id,
    name: team.name,
    latestVersion: team.submissions[0]?.version ?? null,
    latestLate: team.submissions[0]?.isLate ?? false,
    teamScore: teamScore.get(team.id) ?? null,
    evaluations: team.evaluations.map((evaluation) => ({
      id: evaluation.id,
      evaluatorName: evaluation.evaluatorName ?? 'evaluator',
      mine: evaluation.evaluatorUserId === viewer.userId,
      targetLabel: evaluation.memberId ? (names.get(evaluation.memberId) ?? 'participant') : 'Team',
      individual: evaluation.memberId !== null,
      scores: evaluation.scores,
      overallScore: evaluation.overallScore,
      notes: evaluation.notes,
      updatedAt: formatTimestamp(evaluation.updatedAt, viewer.timeZone),
    })),
    targets: scoreTargets(team, viewer),
  }));

  return (
    <EvaluationPanel
      trialId={view.id}
      criteria={view.rubric}
      teams={teams}
      canScore={view.status === 'evaluating' && can(ctx, 'canEvaluateTrials')}
      scoringClosedReason={scoringClosedReason(view.status)}
      action={evaluateAction}
    />
  );
}

/** Rank codes at or below `recommended` (by catalog ordinal), highest first. */
function ranksUpTo(catalog: Catalog, recommended: string | null): string[] {
  if (!recommended) return [];
  const ceiling = catalog.tiers.find((tier) => tier.code === recommended);
  if (!ceiling) return [];
  return catalog.tiers
    .filter((tier) => tier.ordinal <= ceiling.ordinal)
    .sort((a, b) => b.ordinal - a.ordinal)
    .map((tier) => tier.code);
}

export async function ResultsTab({
  ctx,
  view,
  viewer,
  catalog,
}: {
  ctx: UserContext;
  view: StaffView;
  viewer: Viewer;
  catalog: Catalog;
}) {
  const facetLabel = new Map(catalog.facets.map((facet) => [facet.key, facet.label]));
  const names = new Map(view.participants.map((p) => [p.memberId, p.displayName]));
  const teamName = new Map(view.teams.map((team) => [team.id, team.name]));
  let rows: ResultRowData[] = [];
  let counts = EMPTY_COUNTS;

  if (view.status === 'evaluating') {
    // Live preview (thresholds read now); incomplete reasons drive the publish warning.
    const preview = await guarded(() => trials.previewResults(ctx, { trialId: view.id }));
    if (preview.ok) {
      counts = preview.value.counts;
      rows = preview.value.results.map((result) => ({
        memberId: result.memberId,
        displayName: result.displayName || names.get(result.memberId) || 'participant',
        teamName: result.teamName || (teamName.get(result.teamId) ?? ''),
        teamScore: result.teamScore,
        individualScore: result.individualScore,
        finalScore: result.finalScore,
        outcome: result.outcome,
        incompleteReason: result.incompleteReason ?? null,
        facetLabel: result.facetKey ? (facetLabel.get(result.facetKey) ?? result.facetKey) : null,
        recommendedRank: result.recommendedRank,
        rankApplied: false,
        appliedRank: null,
        rankOptions: [],
      }));
    }
  } else if (view.status === 'completed' && view.results?.published) {
    // The published record, exactly as stored.
    counts = { ...EMPTY_COUNTS };
    rows = view.results.rows.map((result) => {
      counts[result.outcome] += 1;
      return {
        memberId: result.memberId,
        displayName: names.get(result.memberId) ?? 'participant',
        teamName: result.teamId ? (teamName.get(result.teamId) ?? '') : '',
        teamScore: result.teamScore,
        individualScore: result.individualScore,
        finalScore: result.finalScore,
        outcome: result.outcome,
        incompleteReason: null,
        facetLabel: result.facetKey ? (facetLabel.get(result.facetKey) ?? result.facetKey) : null,
        recommendedRank: result.recommendedRank,
        rankApplied: result.rankApplied,
        appliedRank: result.appliedRank,
        rankOptions: result.rankApplied ? [] : ranksUpTo(catalog, result.recommendedRank),
      };
    });
  }

  return (
    <ResultsPanel
      trialId={view.id}
      published={view.status === 'completed'}
      rows={rows}
      counts={counts}
      canPublish={view.status === 'evaluating' && can(ctx, 'canManageTrials')}
      canApplyRanks={can(ctx, 'canModifyRanks')}
      viewerMemberId={viewer.memberId}
      publishAction={publishResultsAction}
      applyRankAction={applyRankAction}
    />
  );
}
