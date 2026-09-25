import type { StopRule } from '../types';
import type { Estimate } from './estimate';

export type StopReason = 'se' | 'max-items' | 'time' | null;

/** Combined stopping rule: precision reached after a minimum length, maximum length, or time budget (Babcock & Weiss, 2012). */
export function shouldStop(rule: StopRule, estimate: Estimate, activeMs: number): StopReason {
  if (estimate.n >= rule.maxItems) return 'max-items';
  if (activeMs >= rule.maxMs && estimate.n >= Math.min(rule.minItems, 3)) return 'time';
  if (estimate.n >= rule.minItems && estimate.se <= rule.seTarget) return 'se';
  return null;
}
