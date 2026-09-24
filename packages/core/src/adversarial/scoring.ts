import { adversarialOutcome } from '@jave/database';
import type { Outcome } from './state';

/**
 * Security-culture scoring (pure).
 *
 * The suggested score starts from a neutral baseline and moves with each
 * observation: resisting, detecting and reporting raise it; partial
 * compliance and failures lower it. It is a starting point for the evaluator,
 * not a verdict — the evaluator may override it with a written justification.
 * With no observations there is no basis for a score, so none is suggested.
 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
export const SCORE_BASELINE = 5;

export const OUTCOME_WEIGHTS: Readonly<Record<Outcome, number>> = {
  reported: 2,
  detected: 1.5,
  resisted: 1,
  partial: -1,
  failure: -2.5,
};

export type OutcomeCounts = Record<Outcome, number>;

export function countOutcomes(outcomes: readonly Outcome[]): OutcomeCounts {
  const counts = Object.fromEntries(
    adversarialOutcome.enumValues.map((o) => [o, 0]),
  ) as OutcomeCounts;
  for (const outcome of outcomes) counts[outcome] += 1;
  return counts;
}

/** Suggested 0–10 score, or null when there are no observations to base it on. */
export function suggestScore(outcomes: readonly Outcome[]): number | null {
  if (outcomes.length === 0) return null;
  const raw = outcomes.reduce((sum, outcome) => sum + OUTCOME_WEIGHTS[outcome], SCORE_BASELINE);
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(raw)));
}
