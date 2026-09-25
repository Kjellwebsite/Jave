/** Assemble the report from a session. See docs/SCORING.md §6. */
import { interval90, type Estimate } from '../adaptive/estimate';
import { bandFor } from '../adaptive/irt';
import { DOMAINS, type DomainInfo } from '../engine/domains';
import { getParadigm, isItemParadigm } from '../engine/registry';
import type { ItemParadigm } from '../items/paradigm';
import type { Band, Metric, Mode, SectionGroup, Session } from '../types';
import { domainEstimate, generalEstimate, observations, paradigmEstimate, type ScoredObservation } from './estimates';
import { metacognition, type MetaReport } from './metacognition';
import { rankFor, type Rank } from './rank';

export const MIN_ITEMS_FOR_ESTIMATE = 3;

export interface EstimateView {
  theta: number;
  se: number;
  lo: number;
  hi: number;
  n: number;
  rank: Rank;
  rankLo: Rank;
  rankHi: Rank;
  band: Band;
  provisional: boolean;
  ceiling: boolean;
  floor: boolean;
}

export interface FacetView {
  paradigm: string;
  title: string;
  subtitle: string;
  construct: string;
  group: SectionGroup;
  experimental: boolean;
  load?: 'knowledge' | 'reasoning';
  status: 'done' | 'skipped' | 'not-taken';
  estimate: EstimateView | null;
  metrics: Metric[];
  items: number;
  rapid: number;
  excluded: number;
  highestLevelSolved: number | null;
  stopReason?: string;
  detail?: Record<string, unknown>;
}

export interface DomainView {
  info: DomainInfo;
  estimate: EstimateView | null;
  facets: FacetView[];
}

export interface Report {
  sessionId: string;
  mode: Mode;
  complete: boolean;
  createdAt: number;
  durationMs: number;
  general: EstimateView | null;
  domains: DomainView[];
  performance: FacetView[];
  creativity: FacetView[];
  applied: FacetView[];
  metacognition: MetaReport;
  uncertainty: { label: string; se: number; n: number; ceiling: boolean; floor: boolean }[];
  conditions: {
    input: string;
    viewport: string;
    browser: string;
    reducedMotion: boolean;
    resumes: number;
    voided: number;
    hidden: number;
    duplicates: number;
    rapid: number;
    totalItems: number;
    attempt: number;
  };
}

function view(e: Estimate, obs: ScoredObservation[], range?: { minB: number; maxB: number }): EstimateView | null {
  if (e.n < MIN_ITEMS_FOR_ESTIMATE) return null;
  const [lo, hi] = interval90(e);
  let ceiling = false;
  let floor = false;
  if (range) {
    const top = obs.filter((o) => o.b >= range.maxB - 1e-6);
    const bottom = obs.filter((o) => o.b <= range.minB + 1e-6);
    ceiling = e.theta > range.maxB - 0.5 && top.length >= 2 && top.slice(-2).every((o) => o.correct);
    floor = e.theta < range.minB + 0.5 && bottom.length >= 2 && bottom.slice(-2).every((o) => !o.correct);
  }
  return {
    theta: e.theta,
    se: e.se,
    lo,
    hi,
    n: e.n,
    rank: rankFor(e.theta),
    rankLo: rankFor(lo),
    rankHi: rankFor(hi),
    band: bandFor(e.theta),
    provisional: true,
    ceiling,
    floor,
  };
}

function facetView(session: Session, paradigmId: string): FacetView {
  const p = getParadigm(paradigmId);
  const section = session.sections.find((s) => s.paradigm === paradigmId);
  const obs = observations(session).filter((o) => o.paradigm === paradigmId);
  const range = isItemParadigm(p) ? (p as ItemParadigm).range() : obs.length ? { minB: Math.min(...obs.map((o) => o.b)), maxB: Math.max(...obs.map((o) => o.b)) } : undefined;
  const hasIrt = obs.length > 0;
  const solved = obs.filter((o) => o.correct).map((o) => o.level);
  return {
    paradigm: p.id,
    title: p.title,
    subtitle: p.subtitle,
    construct: p.construct,
    group: p.group,
    experimental: !!p.experimental,
    load: p.load,
    status: !section || section.status !== 'done' ? 'not-taken' : section.stopReason === 'skipped' ? 'skipped' : 'done',
    estimate: hasIrt ? view(paradigmEstimate(session, paradigmId), obs, range) : null,
    metrics: section?.procedure?.score?.metrics ?? [],
    items: section?.responses.length ?? 0,
    rapid: section?.responses.filter((r) => r.rapid).length ?? 0,
    excluded: section?.responses.filter((r) => r.excluded).length ?? 0,
    highestLevelSolved: solved.length ? Math.max(...solved) : null,
    stopReason: section?.stopReason,
    detail: section?.procedure?.score?.detail,
  };
}

export function generateReport(session: Session): Report {
  const planned = [...new Set(session.plan.map((p) => p.paradigm))];
  const facets = planned.map((id) => facetView(session, id));
  const byGroup = (g: SectionGroup) => facets.filter((f) => f.group === g);

  const domains: DomainView[] = DOMAINS.map((info) => {
    const domainFacets = facets.filter((f) => getParadigm(f.paradigm).domain === info.id && (f.group === 'core' || info.status === 'performance'));
    const obs = observations(session).filter((o) => o.domain === info.id && getParadigm(o.paradigm).group === 'core');
    const est = obs.length ? view(domainEstimate(session, info.id), obs) : null;
    if (est) est.ceiling = domainFacets.some((f) => f.estimate?.ceiling);
    if (est) est.floor = domainFacets.some((f) => f.estimate?.floor);
    return { info, estimate: est, facets: domainFacets };
  });

  const generalObs = observations(session).filter((o) => o.domain !== 'natural' && getParadigm(o.paradigm).group === 'core');
  const general = generalObs.length ? view(generalEstimate(session), generalObs) : null;

  const responses = session.sections.flatMap((s) => s.responses);
  const count = (t: string) => session.events.filter((e) => e.type === t).length;
  const first = session.createdAt;
  const last = session.sections.reduce((m, s) => Math.max(m, s.finishedAt ?? 0), session.updatedAt);

  const uncertainty = [
    ...domains.filter((d) => d.estimate).map((d) => ({ label: d.info.name, se: d.estimate!.se, n: d.estimate!.n, ceiling: d.estimate!.ceiling, floor: d.estimate!.floor })),
  ].sort((a, b) => b.se - a.se);

  return {
    sessionId: session.id,
    mode: session.mode,
    complete: session.status === 'complete',
    createdAt: session.createdAt,
    durationMs: last - first,
    general,
    domains,
    performance: byGroup('performance'),
    creativity: byGroup('creativity'),
    applied: byGroup('applied'),
    metacognition: metacognition(session),
    uncertainty,
    conditions: {
      input: session.device.input === 'touch' ? 'Touch' : 'Mouse and keyboard',
      viewport: session.device.viewport,
      browser: session.device.browser,
      reducedMotion: session.device.reducedMotion,
      resumes: count('resume'),
      voided: count('void'),
      hidden: count('hidden'),
      duplicates: count('duplicate'),
      rapid: responses.filter((r) => r.rapid).length,
      totalItems: responses.length,
      attempt: session.attempt,
    },
  };
}
