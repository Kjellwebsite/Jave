import { NORMS } from './norms';
import type { InputKind, Rank } from './types';

export const RANKS: { rank: Rank; minPercentile: number; label: string; band: string }[] = [
  { rank: 'S', minPercentile: 97, label: 'Exceptional', band: 'Top 3%' },
  { rank: 'A', minPercentile: 85, label: 'Superior', band: 'Top 15%' },
  { rank: 'B', minPercentile: 65, label: 'Strong', band: 'Top 35%' },
  { rank: 'C', minPercentile: 35, label: 'Solid', band: 'Middle 30%' },
  { rank: 'D', minPercentile: 15, label: 'Developing', band: 'Bottom 35%' },
  { rank: 'E', minPercentile: 5, label: 'Emerging', band: 'Bottom 15%' },
  { rank: 'F', minPercentile: 0, label: 'Foundational', band: 'Bottom 5%' },
];

export const rankInfo = (rank: Rank) => RANKS.find((r) => r.rank === rank)!;

/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function zScore(taskId: string, score: number, input: InputKind): number {
  const norm = NORMS[taskId];
  if (!norm) return 0;
  const { mean, sd } = norm.byInput?.[input] ?? norm;
  const value = norm.log ? Math.log10(Math.max(score, 1e-4)) : score;
  const z = (value - mean) / sd;
  // Clamp so a single extreme trial cannot produce absurd percentiles.
  return Math.max(-3.5, Math.min(3.5, norm.higherIsBetter ? z : -z));
}

export const percentileFromZ = (z: number) => normCdf(z) * 100;

export function rankFromPercentile(p: number): Rank {
  return (RANKS.find((r) => p >= r.minPercentile) ?? RANKS[RANKS.length - 1]).rank;
}

/**
 * Combines domain z-scores into the overall JVLN score.
 * Averaging correlated scores shrinks their spread, so the mean is rescaled by
 * the SD of a mean of k scores with average intercorrelation r.
 */
const DOMAIN_INTERCORRELATION = 0.3;

export function compositeZ(zs: number[]): number {
  const k = zs.length;
  if (!k) return 0;
  const m = zs.reduce((a, b) => a + b, 0) / k;
  const sdOfMean = Math.sqrt((1 + (k - 1) * DOMAIN_INTERCORRELATION) / k);
  return m / sdOfMean;
}

/** "Top 12%" above the middle, "Bottom 20%" below it. Never shows 0% or 100%. */
export function topLabel(percentile: number): string {
  if (percentile >= 50) return `Top ${Math.min(50, Math.max(1, Math.round(100 - percentile)))}%`;
  return `Bottom ${Math.min(50, Math.max(1, Math.round(percentile)))}%`;
}
