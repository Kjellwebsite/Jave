import { eap, type Estimate, type Observation } from '../adaptive/estimate';
import { getParadigm, isItemParadigm } from '../engine/registry';
import type { DomainId, Session } from '../types';

export interface ScoredObservation extends Observation {
  paradigm: string;
  domain: DomainId;
  facet: string;
  level: number;
  b: number;
}

/** Every observation usable for IRT estimation: non-rapid, non-excluded item responses plus procedure outcomes. */
export function observations(session: Session): ScoredObservation[] {
  const out: ScoredObservation[] = [];
  for (const section of session.sections) {
    for (const r of section.responses) {
      if (r.rapid || r.excluded) continue;
      out.push({ irt: r.irt, correct: r.correct, paradigm: r.paradigm, domain: r.domain, facet: r.facet, level: r.level, b: r.irt.b });
    }
    const outcomes = section.procedure?.score?.outcomes ?? [];
    const paradigm = getParadigm(section.paradigm);
    for (const o of outcomes) {
      out.push({ irt: o.irt, correct: o.correct, paradigm: section.paradigm, domain: paradigm.domain, facet: o.facet, level: o.level, b: o.irt.b });
    }
  }
  return out;
}

export function estimateWhere(session: Session, pred: (o: ScoredObservation) => boolean): Estimate {
  return eap(observations(session).filter(pred));
}

export const paradigmEstimate = (session: Session, paradigm: string) => estimateWhere(session, (o) => o.paradigm === paradigm);

/** Domain estimates use core paradigms only; applied and creativity paradigms are reported on their own. */
export const domainEstimate = (session: Session, domain: DomainId) =>
  estimateWhere(session, (o) => o.domain === domain && getParadigm(o.paradigm).group === 'core');

/** Domains that enter the general estimate. Adaptive/Natural is experimental and excluded. */
export const GENERAL_EXCLUDED: DomainId[] = ['natural'];

export function isGeneralObservation(o: ScoredObservation): boolean {
  if (GENERAL_EXCLUDED.includes(o.domain)) return false;
  const p = getParadigm(o.paradigm);
  return p.group === 'core' && (isItemParadigm(p) || p.kind === 'procedure');
}

export const generalEstimate = (session: Session) => estimateWhere(session, isGeneralObservation);
