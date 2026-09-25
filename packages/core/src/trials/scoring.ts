import { SCORE_DECIMALS, SCORE_MAX, SCORE_MIN } from './constants';

/**
 * Pure scoring. Every number a participant sees can be recomputed from the
 * stored evaluations with these functions.
 */

export type TrialOutcome = 'distinction' | 'pass' | 'fail' | 'incomplete';

/** Why a result is INCOMPLETE. */
export type IncompleteReason = 'no_submission' | 'not_evaluated';

export interface WeightedCriterion {
  key: string;
  weight: number;
}

const SCALE = 10 ** SCORE_DECIMALS;

export function roundScore(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Weighted mean of per-criterion scores (0–10). Weights are relative.
 * Throws if a criterion is unscored or a score is out of range — callers
 * validate first; this is the last line of defence.
 */
export function weightedScore(
  rubric: readonly WeightedCriterion[],
  scores: Readonly<Record<string, number>>,
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const criterion of rubric) {
    const score = scores[criterion.key];
    if (score === undefined) throw new RangeError(`missing score for ${criterion.key}`);
    if (!Number.isFinite(score) || score < SCORE_MIN || score > SCORE_MAX)
      throw new RangeError(`score out of range for ${criterion.key}`);
    weighted += criterion.weight * score;
    totalWeight += criterion.weight;
  }
  if (totalWeight <= 0) throw new RangeError('rubric has no weight');
  return roundScore(weighted / totalWeight);
}

export interface OutcomeThresholds {
  passThreshold: number;
  distinctionThreshold: number;
}

/**
 * Outcome for an assessable final score. A misconfigured distinction
 * threshold below the pass mark is treated as equal to the pass mark.
 */
export function outcomeFor(finalScore: number, thresholds: OutcomeThresholds): TrialOutcome {
  const distinction = Math.max(thresholds.distinctionThreshold, thresholds.passThreshold);
  if (finalScore >= distinction) return 'distinction';
  if (finalScore >= thresholds.passThreshold) return 'pass';
  return 'fail';
}

/**
 * Score → recommended verified rank for the trial's primary facet. Only
 * passing results recommend a rank. A single trial never recommends S:
 * S requires sustained, independently evidenced excellence.
 */
export const RANK_RECOMMENDATION_LADDER: readonly { minScore: number; rank: string }[] = [
  { minScore: 9, rank: 'A' },
  { minScore: 8, rank: 'B' },
  { minScore: 7, rank: 'C' },
  { minScore: 6, rank: 'D' },
  { minScore: 5, rank: 'E' },
  { minScore: 0, rank: 'F' },
];

export function recommendRank(finalScore: number | null, outcome: TrialOutcome): string | null {
  if (finalScore === null || (outcome !== 'pass' && outcome !== 'distinction')) return null;
  return RANK_RECOMMENDATION_LADDER.find((step) => finalScore >= step.minScore)?.rank ?? null;
}

export interface ResultParticipant {
  memberId: string;
  teamId: string;
}

export interface ResultEvaluation {
  teamId: string | null;
  /** Null for a team evaluation; set for an individual evaluation. */
  memberId: string | null;
  overallScore: number;
}

export interface ComputeResultsInput extends OutcomeThresholds {
  participants: readonly ResultParticipant[];
  /** Teams with at least one submission. */
  submittedTeamIds: ReadonlySet<string>;
  evaluations: readonly ResultEvaluation[];
  /** Share of the final score that comes from the team score (0–1). */
  teamWeight: number;
  /** Primary facet of the trial; null when the trial maps to none. */
  facetKey: string | null;
}

export interface ComputedResult {
  memberId: string;
  teamId: string;
  teamScore: number | null;
  individualScore: number | null;
  finalScore: number | null;
  outcome: TrialOutcome;
  incompleteReason: IncompleteReason | null;
  facetKey: string | null;
  recommendedRank: string | null;
}

/**
 * Results for every participant.
 *
 * - teamScore = mean of the team evaluations of the member's team.
 * - individualScore = mean of the member's individual evaluations, else teamScore.
 * - When a team has no team evaluation, its members' individual scores stand in.
 * - final = teamWeight × team + (1 − teamWeight) × individual.
 * - INCOMPLETE when the team never submitted, or nothing about the member was evaluated.
 */
export function computeResults(input: ComputeResultsInput): ComputedResult[] {
  const teamWeight = Math.min(1, Math.max(0, input.teamWeight));
  const teamScores = new Map<string, number[]>();
  const memberScores = new Map<string, number[]>();
  for (const evaluation of input.evaluations) {
    if (evaluation.memberId) {
      const list = memberScores.get(evaluation.memberId) ?? [];
      list.push(evaluation.overallScore);
      memberScores.set(evaluation.memberId, list);
    } else if (evaluation.teamId) {
      const list = teamScores.get(evaluation.teamId) ?? [];
      list.push(evaluation.overallScore);
      teamScores.set(evaluation.teamId, list);
    }
  }

  return input.participants.map((participant): ComputedResult => {
    const incomplete = (reason: IncompleteReason): ComputedResult => ({
      memberId: participant.memberId,
      teamId: participant.teamId,
      teamScore: null,
      individualScore: null,
      finalScore: null,
      outcome: 'incomplete',
      incompleteReason: reason,
      facetKey: input.facetKey,
      recommendedRank: null,
    });
    if (!input.submittedTeamIds.has(participant.teamId)) return incomplete('no_submission');
    const team = mean(teamScores.get(participant.teamId) ?? []);
    const individual = mean(memberScores.get(participant.memberId) ?? []);
    if (team === null && individual === null) return incomplete('not_evaluated');
    const effectiveTeam = team ?? individual!;
    const effectiveIndividual = individual ?? team!;
    const finalScore = roundScore(
      teamWeight * effectiveTeam + (1 - teamWeight) * effectiveIndividual,
    );
    const outcome = outcomeFor(finalScore, input);
    return {
      memberId: participant.memberId,
      teamId: participant.teamId,
      teamScore: team === null ? null : roundScore(team),
      individualScore: roundScore(effectiveIndividual),
      finalScore,
      outcome,
      incompleteReason: null,
      facetKey: input.facetKey,
      recommendedRank: input.facetKey ? recommendRank(finalScore, outcome) : null,
    };
  });
}

export function isPassing(outcome: TrialOutcome): boolean {
  return outcome === 'pass' || outcome === 'distinction';
}
