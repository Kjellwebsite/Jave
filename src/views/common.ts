import { h } from '../core/dom';
import { compositeZ, percentileFromZ, rankFromPercentile } from '../core/scoring';
import { getResults } from '../core/storage';
import type { Rank, StoredResult } from '../core/types';
import { DOMAINS } from '../domains';
import { CORE } from '../tasks';

export interface Nav {
  home(): void;
  task(id: string, mode: 'core' | 'single'): void;
  report(): void;
}

export function rankGlyph(rank: Rank, cls = ''): HTMLElement {
  return h('span', { class: `rank-glyph rank-${rank.toLowerCase()} ${cls}`, 'aria-label': `Rank ${rank}` }, rank);
}

export function wordmark(): HTMLElement {
  return h(
    'span',
    { class: 'wordmark' },
    h('span', { class: 'wordmark-jvln' }, 'JVLN'),
    h('span', { class: 'wordmark-by' }, 'by Javelin'),
  );
}

export function siteHeader(nav: Nav, onReport = false): HTMLElement {
  const hasResults = !onReport && Object.keys(getResults()).length > 0;
  return h(
    'header',
    { class: 'site-header' },
    h('button', { class: 'wordmark-btn', type: 'button', onclick: () => nav.home(), 'aria-label': 'JVLN home' }, wordmark()),
    hasResults ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => nav.report() }, 'Your report') : null,
  );
}

export function siteFooter(): HTMLElement {
  return h(
    'footer',
    { class: 'site-footer' },
    h('p', null, 'JVLN is a cognitive self-assessment for insight and fun. It is not a clinical or diagnostic test.'),
    h('p', null, 'Ranks compare you with other JVLN users. They are marked provisional until each task has enough first attempts.'),
    h('p', { class: 'mono' }, `© ${new Date().getFullYear()} Javelin`),
  );
}

export interface Overall {
  done: StoredResult[];
  z: number;
  percentile: number;
  rank: Rank;
}

export function overall(): Overall | null {
  const results = getResults();
  const done = CORE.map((t) => results[t.id]).filter((r): r is StoredResult => !!r);
  if (!done.length) return null;
  const z = compositeZ(done.map((r) => r.z));
  const percentile = percentileFromZ(z);
  return { done, z, percentile, rank: rankFromPercentile(percentile) };
}

export const nextIncomplete = () => CORE.find((t) => !getResults()[t.id]);

export const TOTAL_FACETS = DOMAINS.reduce((s, d) => s + d.facets.length, 0);

/** Share of all facets in the JVLN model that the user has a measurement for. */
export function measuredFacets(): number {
  const results = getResults();
  const set = new Set<string>();
  for (const t of CORE) {
    if (!results[t.id]) continue;
    const domain = DOMAINS.find((d) => d.id === t.domain)!;
    t.measures.filter((m) => domain.facets.includes(m)).forEach((m) => set.add(`${t.domain}:${m}`));
  }
  return set.size;
}
