import { eq } from 'drizzle-orm';
import { trialEvaluations } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { isValidFacet, isValidRank, loadCatalog } from '../identity/ranks';
import { getSettings } from '../settings/settings.service';
import {
  loadCompetitors,
  loadTeams,
  type ParticipantDetail,
  submittedTeamIds,
  type TeamRecord,
  type TrialRecord,
} from './repository';
import { type ComputedResult, computeResults } from './scoring';

export interface TrialResultsSnapshot {
  results: ComputedResult[];
  competitors: ParticipantDetail[];
  teams: TeamRecord[];
  submitted: Set<string>;
  passThreshold: number;
}

/**
 * Compute results from the stored evaluations with the current settings. The
 * primary facet is the first of the trial's facets that still exists in the
 * catalog; recommended ranks are dropped if their tier is disabled.
 */
export async function computeTrialResults(
  ctx: ServiceContext,
  trial: TrialRecord,
): Promise<TrialResultsSnapshot> {
  const [settings, catalog, competitors, teams, submitted, evaluations] = await Promise.all([
    getSettings(ctx, 'trials'),
    loadCatalog(ctx),
    loadCompetitors(ctx, trial.id),
    loadTeams(ctx, trial.id),
    submittedTeamIds(ctx, trial.id),
    ctx.db
      .select({
        teamId: trialEvaluations.teamId,
        memberId: trialEvaluations.memberId,
        overallScore: trialEvaluations.overallScore,
      })
      .from(trialEvaluations)
      .where(eq(trialEvaluations.trialId, trial.id)),
  ]);
  const facetKey = trial.facetKeys.find((key) => isValidFacet(catalog, key)) ?? null;
  const results = computeResults({
    participants: competitors.map((c) => ({ memberId: c.memberId, teamId: c.teamId! })),
    submittedTeamIds: submitted,
    evaluations,
    teamWeight: settings.teamWeight,
    passThreshold: settings.passThreshold,
    distinctionThreshold: settings.distinctionThreshold,
    facetKey,
  }).map((result) => ({
    ...result,
    recommendedRank:
      result.recommendedRank && isValidRank(catalog, result.recommendedRank)
        ? result.recommendedRank
        : null,
  }));
  return { results, competitors, teams, submitted, passThreshold: settings.passThreshold };
}
