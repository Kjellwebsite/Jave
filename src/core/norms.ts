import type { Norm } from './types';

/**
 * Provisional norms.
 *
 * JVLN ranks people against other JVLN users. Until a task has enough first
 * attempts (see MIN_SAMPLE), scores are compared against these starting values,
 * which are estimates based on published results for similar tasks. Once the
 * backend collects data, these get replaced by live user norms per task and
 * input type.
 */
export const MIN_SAMPLE = 500;

export const NORMS: Record<string, Norm> = {
  // Proportion of difficulty-weighted matrix items solved.
  matrix: { mean: 0.55, sd: 0.22, higherIsBetter: true },
  // Corsi block span (half points for solving both trials at the top length).
  corsi: { mean: 5.8, sd: 1.1, higherIsBetter: true },
  // Mean of simple and choice reaction time medians, in ms, plus error penalty.
  reaction: {
    mean: 360,
    sd: 50,
    higherIsBetter: false,
    byInput: { touch: { mean: 405, sd: 60 } },
  },
  // Proportion correct in the card sort.
  cardsort: { mean: 0.74, sd: 0.11, higherIsBetter: true },
  // Mix of learning accuracy and transfer accuracy.
  aliens: { mean: 0.72, sd: 0.12, higherIsBetter: true },
  // Proportion of expected value choices made correctly under time pressure.
  odds: { mean: 0.72, sd: 0.14, higherIsBetter: true },
  // Proportion of remote associate triads solved within the time limit.
  rat: { mean: 0.42, sd: 0.2, higherIsBetter: true },
  // Type-2 AUROC: how well confidence separates correct from wrong answers.
  signal: { mean: 0.66, sd: 0.08, higherIsBetter: true },
  // Proportion of theory of mind stories answered correctly.
  minds: { mean: 0.72, sd: 0.15, higherIsBetter: true },
  // Proportion of vocabulary and analogy items correct.
  words: { mean: 0.62, sd: 0.17, higherIsBetter: true },
  // Motion coherence threshold, compared on a log scale.
  motion: { mean: -0.95, sd: 0.25, higherIsBetter: false, log: true },
};
