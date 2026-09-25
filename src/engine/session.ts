import { selectCandidate } from '../adaptive/select';
import { shouldStop } from '../adaptive/stopping';
import type { ItemParadigm } from '../items/paradigm';
import { domainEstimate, paradigmEstimate } from '../scoring/estimates';
import type {
  Action,
  DeviceInfo,
  Mode,
  PendingStep,
  ResponseRecord,
  SectionPlan,
  SectionState,
  Session,
  SessionEvent,
  Step,
} from '../types';
import { clamp } from '../utils/math';
import { createRng, hashSeed, randomSeed } from '../utils/rng';
import { getParadigm, isItemParadigm, isProcedureParadigm } from './registry';

/** Early items may move at most this far from the previous item's difficulty. */
const MAX_EARLY_STEP = 1.5;
const EARLY_ITEMS = 3;

export interface CreateOptions {
  mode: Mode;
  plan: SectionPlan[];
  device: DeviceInfo;
  now: number;
  seed?: number;
  attempt?: number;
  id?: string;
  seen?: string[];
}

export function createSession(opts: CreateOptions): Session {
  const seed = opts.seed ?? randomSeed();
  return {
    schema: 1,
    id: opts.id ?? `s_${seed.toString(36)}_${opts.now.toString(36)}`,
    seed,
    mode: opts.mode,
    createdAt: opts.now,
    updatedAt: opts.now,
    status: opts.plan.length ? 'active' : 'complete',
    device: opts.device,
    plan: opts.plan,
    sections: opts.plan.map((p) => ({ id: p.id, paradigm: p.paradigm, status: 'pending', practice: [], used: [], responses: [] })),
    cursor: 0,
    pending: null,
    counter: 0,
    events: [{ at: opts.now, type: 'start', detail: opts.mode }],
    attempt: opts.attempt ?? 1,
    seen: opts.seen ?? [],
  };
}

/** What the UI should show now. Pure read. */
export function getStep(session: Session): Step {
  if (session.status === 'complete') return { type: 'complete' };
  if (session.pending) return session.pending;
  return { type: 'intro', section: session.cursor };
}

/** Apply an action and return the next session. The input is never mutated. */
export function dispatch(input: Session, action: Action, now: number): Session {
  const s: Session = structuredClone(input);
  s.updatedAt = now;
  switch (action.type) {
    case 'begin': {
      if (s.status === 'complete' || s.pending || action.section !== s.cursor) return logDuplicate(s, now, 'begin');
      const section = s.sections[s.cursor];
      section.status = s.plan[s.cursor].practice > 0 && hasPractice(section.paradigm) ? 'practice' : 'active';
      section.startedAt = now;
      s.events.push({ at: now, type: 'section-start', detail: section.id });
      issueNext(s, now);
      return s;
    }
    case 'practice-answer': {
      const p = s.pending;
      if (!p || p.type !== 'practice' || p.stepId !== action.stepId) return logDuplicate(s, now, action.stepId);
      const paradigm = getParadigm(p.item.paradigm) as ItemParadigm;
      const result = paradigm.score(p.item, action.value);
      s.sections[p.section].practice.push({ stepId: p.stepId, itemId: p.item.id, correct: result.correct });
      s.pending = null;
      issueNext(s, now);
      return s;
    }
    case 'answer': {
      const p = s.pending;
      if (!p || p.type !== 'item' || p.stepId !== action.stepId) return logDuplicate(s, now, action.stepId);
      const paradigm = getParadigm(p.item.paradigm) as ItemParadigm;
      const rtMs = Math.max(0, Math.round(action.rtMs));
      const timedOut = action.value.kind === 'timeout' || rtMs > p.item.timeLimitMs + 1500;
      const result = timedOut ? { correct: false } : paradigm.score(p.item, action.value, action.aux);
      const record: ResponseRecord = {
        stepId: p.stepId,
        itemId: p.item.id,
        paradigm: p.item.paradigm,
        domain: p.item.domain,
        facet: p.item.facet,
        level: p.item.level,
        irt: p.item.irt,
        value: action.value,
        correct: result.correct,
        rtMs,
        timedOut,
        rapid: !timedOut && rtMs < paradigm.minRtMs,
        excluded: 'excluded' in result ? result.excluded : undefined,
        confidence: p.confidence && typeof action.confidence === 'number' ? clamp(action.confidence, 0, 1) : undefined,
        at: now,
      };
      const section = s.sections[p.section];
      section.responses.push(record);
      section.used.push(p.item.id);
      s.pending = null;
      issueNext(s, now);
      return s;
    }
    case 'procedure-result': {
      const p = s.pending;
      if (!p || p.type !== 'procedure' || p.stepId !== action.stepId) return logDuplicate(s, now, action.stepId);
      const paradigm = getParadigm(s.sections[p.section].paradigm);
      if (!isProcedureParadigm(paradigm) || !paradigm.validate(action.result)) {
        s.events.push({ at: now, type: 'void', detail: `invalid result ${p.stepId}` });
        return s;
      }
      const section = s.sections[p.section];
      const rng = createRng(hashSeed(s.seed, section.id, 'score'));
      section.procedure = { config: p.config, result: action.result, score: paradigm.score(p.config, action.result, rng) };
      s.pending = null;
      finishSection(s, now, 'procedure');
      return s;
    }
    case 'skip-section': {
      if (s.status === 'complete' || action.section !== s.cursor) return logDuplicate(s, now, 'skip');
      s.pending = null;
      finishSection(s, now, 'skipped');
      return s;
    }
    case 'event': {
      s.events.push({ at: now, type: action.event, detail: action.detail });
      return s;
    }
  }
}

/**
 * Restore a stored session after a reload. An item or procedure that was on
 * screen is voided and replaced, so nobody gains extra viewing time.
 */
export function resumeSession(input: Session, now: number): Session {
  const s: Session = structuredClone(input);
  s.events.push({ at: now, type: 'resume' });
  if (s.pending && s.status === 'active') {
    s.events.push({ at: now, type: 'void', detail: `${s.pending.type}:${s.pending.stepId}` });
    s.pending = null;
    issueNext(s, now);
  }
  s.updatedAt = now;
  return s;
}

export function sectionActiveMs(section: SectionState): number {
  return section.responses.reduce((sum, r) => sum + Math.min(r.rtMs, 600_000), 0);
}

/* ------------------------------------------------------------------ */

function hasPractice(paradigmId: string): boolean {
  const p = getParadigm(paradigmId);
  return isItemParadigm(p);
}

function logDuplicate(s: Session, now: number, detail: string): Session {
  s.events.push({ at: now, type: 'duplicate', detail });
  return s;
}

function nextStepId(s: Session): { stepId: string; seed: number } {
  s.counter += 1;
  return { stepId: `${s.id}.${s.counter}`, seed: hashSeed(s.seed, 'step', s.counter) };
}

function finishSection(s: Session, now: number, reason: NonNullable<SectionState['stopReason']>) {
  const section = s.sections[s.cursor];
  section.status = 'done';
  section.stopReason = reason;
  section.finishedAt = now;
  s.events.push({ at: now, type: 'section-end', detail: `${section.id}:${reason}` });
  s.cursor += 1;
  if (s.cursor >= s.sections.length) {
    s.status = 'complete';
    s.events.push({ at: now, type: 'complete' });
  }
}

/** Put the next step for the current section into `pending`, or close the section. */
function issueNext(s: Session, now: number) {
  if (s.status === 'complete' || s.pending) return;
  const plan = s.plan[s.cursor];
  const section = s.sections[s.cursor];
  const paradigm = getParadigm(plan.paradigm);

  if (isProcedureParadigm(paradigm)) {
    section.status = 'active';
    const { stepId } = nextStepId(s);
    const rng = createRng(hashSeed(s.seed, section.id, 'config'));
    const config = paradigm.build(rng, { mode: s.mode, plan, session: s });
    s.pending = { type: 'procedure', stepId, section: s.cursor, config, issuedAt: now };
    return;
  }

  if (section.status === 'practice') {
    const index = section.practice.length;
    if (index < plan.practice) {
      const { stepId } = nextStepId(s);
      const items = paradigm.practice(createRng(hashSeed(s.seed, section.id, 'practice')), plan.practice);
      if (index < items.length) {
        s.pending = { type: 'practice', stepId, section: s.cursor, item: items[index], issuedAt: now, index };
        return;
      }
    }
    section.status = 'active';
  }

  // Adaptive loop
  const estimate = paradigmEstimate(s, plan.paradigm);
  const stop = shouldStop(plan.stop, estimate, sectionActiveMs(section));
  if (stop) return finishSection(s, now, stop);

  const candidates = paradigm.candidates(section.used);
  if (!candidates.length) return finishSection(s, now, 'exhausted');

  // Core paradigms borrow strength from the whole domain; applied ones use their own responses.
  const basis = paradigm.group === 'core' ? domainEstimate(s, paradigm.domain) : estimate;
  const answered = section.responses.length;
  const selectionTheta = answered === 0 ? clamp(basis.theta, -1, 1) : basis.theta;
  const last = section.responses[answered - 1];
  const facetCounts: Record<string, number> = {};
  for (const r of section.responses) facetCounts[r.facet] = (facetCounts[r.facet] ?? 0) + 1;

  const { stepId, seed } = nextStepId(s);
  const rng = createRng(seed);
  const choice = selectCandidate(selectionTheta, candidates, rng.fork('select'), {
    topK: paradigm.facetTargets ? 3 : 2,
    withinShare: 0.85,
    facetTargets: paradigm.facetTargets,
    facetCounts,
    previousB: last && answered < EARLY_ITEMS ? last.irt.b : undefined,
    avoid: new Set(s.seen.filter((id) => id.startsWith(`${paradigm.id}:`)).map((id) => id.slice(paradigm.id.length + 1))),
    maxStep: MAX_EARLY_STEP,
  });
  if (!choice) return finishSection(s, now, 'exhausted');
  const item = paradigm.instantiate(choice.key, rng.fork('item'));
  const confidence = rng.fork('confidence').chance(plan.confidenceRate);
  s.pending = { type: 'item', stepId, section: s.cursor, item, issuedAt: now, index: answered, confidence };
}

/** Human readable progress for the runner. */
export function progress(s: Session): { section: number; sections: number; itemIndex: number; maxItems: number } {
  const plan = s.plan[Math.min(s.cursor, s.plan.length - 1)];
  const section = s.sections[Math.min(s.cursor, s.sections.length - 1)];
  return { section: s.cursor, sections: s.plan.length, itemIndex: section?.responses.length ?? 0, maxItems: plan?.stop.maxItems ?? 0 };
}

export type { PendingStep, SessionEvent };
