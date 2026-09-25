import type { IrtParams } from '../types';
import type { Rng } from '../utils/rng';
import { information } from './irt';

export interface Candidate {
  /** Level number (as string) for generators, item id for banks. */
  key: string;
  irt: Pick<IrtParams, 'a' | 'b' | 'c'>;
  facet?: string;
}

export interface SelectOptions {
  /** Randomesque: choose among the top k (Kingsbury & Zara, 1989). */
  topK: number;
  /** Only candidates within this share of the best information qualify for the random choice. */
  withinShare: number;
  /** Content targets as shares, e.g. { tom: 0.4, deception: 0.3 }. */
  facetTargets?: Record<string, number>;
  /** Facet counts administered so far. */
  facetCounts?: Record<string, number>;
  /** Keys to avoid (already used), unless nothing else is left. */
  avoid?: Set<string>;
  /** Limit how far the target may move from the previous item's b. */
  previousB?: number;
  maxStep?: number;
}

/** Facet with the largest deficit against its target share (Kingsbury & Zara constrained CAT). */
export function neediestFacet(targets: Record<string, number>, counts: Record<string, number>, available: Set<string>): string | null {
  const total = Object.values(counts).reduce((s, v) => s + v, 0) + 1;
  let best: string | null = null;
  let bestDeficit = -Infinity;
  for (const [facet, share] of Object.entries(targets)) {
    if (!available.has(facet)) continue;
    const deficit = share - (counts[facet] ?? 0) / total;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = facet;
    }
  }
  return best;
}

/** Maximum-information selection with content balancing and randomesque exposure control. */
export function selectCandidate(theta: number, candidates: Candidate[], rng: Rng, opts: SelectOptions): Candidate | null {
  if (!candidates.length) return null;
  let pool = candidates;
  if (opts.avoid?.size) {
    const fresh = pool.filter((c) => !opts.avoid!.has(c.key));
    if (fresh.length) pool = fresh;
  }
  if (opts.facetTargets) {
    const facets = new Set(pool.map((c) => c.facet).filter((f): f is string => !!f));
    const facet = neediestFacet(opts.facetTargets, opts.facetCounts ?? {}, facets);
    if (facet) pool = pool.filter((c) => c.facet === facet);
  }
  let target = theta;
  if (opts.previousB !== undefined && opts.maxStep !== undefined) {
    target = Math.min(opts.previousB + opts.maxStep, Math.max(opts.previousB - opts.maxStep, theta));
  }
  const scored = pool
    .map((c) => ({ c, info: information(target, c.irt) }))
    .sort((x, y) => y.info - x.info);
  const best = scored[0].info;
  const eligible = scored.filter((s) => s.info >= best * opts.withinShare).slice(0, Math.max(1, opts.topK));
  return rng.pick(eligible).c;
}
