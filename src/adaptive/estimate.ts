import type { IrtParams } from '../types';
import { probability } from './irt';

export const THETA_MIN = -4;
export const THETA_MAX = 6;
export const THETA_STEP = 0.02;
/** Prior SD. Wider than 1 to reduce EAP shrinkage for high performers (Bock & Mislevy, 1982). */
export const PRIOR_SD = 1.25;

const GRID: number[] = [];
for (let t = THETA_MIN; t <= THETA_MAX + 1e-9; t += THETA_STEP) GRID.push(Math.round(t * 1000) / 1000);

export interface Observation {
  irt: Pick<IrtParams, 'a' | 'b' | 'c'>;
  correct: boolean;
}

export interface Estimate {
  theta: number;
  se: number;
  n: number;
}

/**
 * Expected a posteriori estimate on a fixed grid.
 * Always finite, including for all-correct and all-wrong patterns.
 */
export function eap(observations: Observation[], priorMean = 0, priorSd = PRIOR_SD): Estimate {
  const logPost = GRID.map((t) => -0.5 * ((t - priorMean) / priorSd) ** 2);
  for (const o of observations) {
    for (let i = 0; i < GRID.length; i++) {
      const p = probability(GRID[i], o.irt);
      logPost[i] += Math.log(o.correct ? Math.max(p, 1e-12) : Math.max(1 - p, 1e-12));
    }
  }
  const max = Math.max(...logPost);
  let norm = 0;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < GRID.length; i++) {
    const w = Math.exp(logPost[i] - max);
    norm += w;
    m1 += w * GRID[i];
    m2 += w * GRID[i] * GRID[i];
  }
  const theta = m1 / norm;
  const variance = Math.max(m2 / norm - theta * theta, 0);
  return { theta, se: Math.sqrt(variance), n: observations.length };
}

export const interval90 = (e: Estimate): [number, number] => [e.theta - 1.645 * e.se, e.theta + 1.645 * e.se];
