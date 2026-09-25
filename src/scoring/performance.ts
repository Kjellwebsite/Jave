/** Performance metric helpers. See docs/SCORING.md §4. */
import type { Metric } from '../types';
import { normInv } from '../utils/math';
import { mean, median, sd } from '../utils/stats';

export const MIN_RT = 150;

/** Correct-trial RTs trimmed to [150 ms, mean + 3 SD] on the log scale. */
export function cleanRts(rts: number[]): number[] {
  const valid = rts.filter((r) => Number.isFinite(r) && r >= MIN_RT);
  if (valid.length < 4) return valid;
  const logs = valid.map(Math.log);
  const cut = Math.exp(mean(logs) + 3 * sd(logs));
  return valid.filter((r) => r <= cut);
}

export const medianRt = (rts: number[]) => median(cleanRts(rts));

export function cv(rts: number[]): number {
  const c = cleanRts(rts);
  return c.length > 2 ? sd(c) / mean(c) : NaN;
}

/** d′ with the log-linear correction (Hautus, 1995). */
export function dPrime(hits: number, signals: number, fas: number, noise: number): number {
  const h = (hits + 0.5) / (signals + 1);
  const f = (fas + 0.5) / (noise + 1);
  return normInv(h) - normInv(f);
}

/** Inverse efficiency: mean correct RT divided by proportion correct. */
export function inverseEfficiency(rts: number[], accuracy: number): number {
  return accuracy > 0 ? mean(cleanRts(rts)) / accuracy : NaN;
}

export const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : '—');
export const pct = (v: number, digits = 0) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—');
export const num = (v: number, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

export function metric(id: string, label: string, value: number, display: string, extra: Partial<Metric> = {}): Metric {
  return {
    id,
    label,
    value: Number.isFinite(value) ? value : null,
    display: Number.isFinite(value) ? display : '—',
    status: Number.isFinite(value) ? 'ok' : 'insufficient',
    ...extra,
  };
}

export const DEVICE_CAVEAT =
  'Includes browser and device latency (roughly 25–100 ms). Comparable only with results from the same device and input type.';
export const DIFFERENCE_CAVEAT =
  'Difference scores like this are robust at group level but have low reliability for individuals (Hedge et al., 2018).';
