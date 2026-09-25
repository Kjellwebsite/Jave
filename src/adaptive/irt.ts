import type { Band, IrtParams } from '../types';

/**
 * Three-parameter logistic model on the logistic metric (D = 1).
 * P(θ) = c + (1 − c) / (1 + exp(−a(θ − b)))
 */
export function probability(theta: number, p: Pick<IrtParams, 'a' | 'b' | 'c'>): number {
  return p.c + (1 - p.c) / (1 + Math.exp(-p.a * (theta - p.b)));
}

/** Fisher information of a 3PL item at θ (Birnbaum, 1968; Lord, 1980). */
export function information(theta: number, p: Pick<IrtParams, 'a' | 'b' | 'c'>): number {
  const P = probability(theta, p);
  if (P <= 0 || P >= 1) return 0;
  return p.a * p.a * ((P - p.c) ** 2 / (1 - p.c) ** 2) * ((1 - P) / P);
}

/** θ at which a 3PL item is most informative. Equals b when c = 0. */
export function thetaMax(p: Pick<IrtParams, 'a' | 'b' | 'c'>): number {
  return p.b + (1 / p.a) * Math.log((1 + Math.sqrt(1 + 8 * p.c)) / 2);
}

/** Internal difficulty band for authoring and display. Not a claim about measured ability. */
export function bandFor(b: number): Band {
  if (b < 0) return 'foundation';
  if (b < 1) return 'standard';
  if (b < 2) return 'advanced';
  if (b < 3) return 'elite';
  return 'apex';
}

export const BAND_LABEL: Record<Band, string> = {
  foundation: 'Foundation',
  standard: 'Standard',
  advanced: 'Advanced',
  elite: 'Elite',
  apex: 'Apex',
};

export function provisional(a: number, b: number, c: number): IrtParams {
  return { a, b, c, calibration: 'provisional' };
}
