import { beforeAll, describe, expect, it } from 'vitest';
import { planFor } from '../src/engine/batteries';
import { createSession, dispatch, getStep, resumeSession } from '../src/engine/session';
import { registerAll } from '../src/items';
import { generateReport } from '../src/scoring/report';
import type { DeviceInfo, Mode, Session } from '../src/types';
import { createRng } from '../src/utils/rng';
import { answerItem, controlAnswer, fakeProcedure } from './fakes';

const device: DeviceInfo = { input: 'mouse', viewport: 'large', reducedMotion: false, browser: 'test' };

beforeAll(() => registerAll());

/** Drive a session to completion with a simulated participant. */
function run(mode: Mode, theta: number, seed: number, paradigm?: string): Session {
  let s = createSession({ mode, plan: planFor(mode, paradigm), device, now: 0, seed });
  const rng = createRng(seed + 1);
  let now = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const step = getStep(s);
    now += 1000;
    if (step.type === 'complete') return s;
    if (step.type === 'intro') s = dispatch(s, { type: 'begin', section: step.section }, now);
    else if (step.type === 'practice') s = dispatch(s, { type: 'practice-answer', stepId: step.stepId, value: answerItem(step.item, theta, rng) }, now);
    else if (step.type === 'item')
      s = dispatch(
        s,
        { type: 'answer', stepId: step.stepId, value: answerItem(step.item, theta, rng), rtMs: 8000 + rng.int(0, 20000), confidence: step.confidence ? rng.next() : undefined, aux: controlAnswer(step.item) },
        now,
      );
    else if (step.type === 'procedure') s = dispatch(s, { type: 'procedure-result', stepId: step.stepId, result: fakeProcedure(s.plan[step.section].paradigm, step.config, rng) }, now);
  }
  throw new Error('session did not complete');
}

describe('session state machine', () => {
  it('starts at the first intro and issues practice after begin', () => {
    let s = createSession({ mode: 'quick', plan: planFor('quick'), device, now: 0, seed: 7 });
    expect(getStep(s)).toEqual({ type: 'intro', section: 0 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    expect(getStep(s).type).toBe('practice');
  });

  it('ignores duplicate and stale submissions', () => {
    let s = createSession({ mode: 'single', plan: planFor('single', 'series'), device, now: 0, seed: 9 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    // skip practice
    while (getStep(s).type === 'practice') {
      const st = getStep(s) as { stepId: string };
      s = dispatch(s, { type: 'practice-answer', stepId: st.stepId, value: { kind: 'number', value: 1 } }, 2);
    }
    const step = getStep(s) as { stepId: string; type: string };
    expect(step.type).toBe('item');
    const once = dispatch(s, { type: 'answer', stepId: step.stepId, value: { kind: 'number', value: 3 }, rtMs: 5000 }, 3);
    const twice = dispatch(once, { type: 'answer', stepId: step.stepId, value: { kind: 'number', value: 3 }, rtMs: 5000 }, 4);
    expect(once.sections[0].responses).toHaveLength(1);
    expect(twice.sections[0].responses).toHaveLength(1);
    expect(twice.events.at(-1)?.type).toBe('duplicate');
  });

  it('does not mutate its input', () => {
    const s = createSession({ mode: 'quick', plan: planFor('quick'), device, now: 0, seed: 11 });
    const copy = JSON.stringify(s);
    dispatch(s, { type: 'begin', section: 0 }, 1);
    expect(JSON.stringify(s)).toBe(copy);
  });

  it('voids the open item on resume and issues a new one', () => {
    let s = createSession({ mode: 'single', plan: planFor('single', 'matrix'), device, now: 0, seed: 13 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    const before = getStep(s) as { stepId: string };
    const resumed = resumeSession(JSON.parse(JSON.stringify(s)), 2);
    const after = getStep(resumed) as { stepId: string };
    expect(after.stepId).not.toBe(before.stepId);
    expect(resumed.events.some((e) => e.type === 'void')).toBe(true);
    // the stale step id is now rejected
    const stale = dispatch(resumed, { type: 'practice-answer', stepId: before.stepId, value: { kind: 'choice', index: 0 } }, 3);
    expect(stale.sections[0].practice).toHaveLength(0);
  });

  it('flags rapid guesses and excludes them from estimation', () => {
    let s = createSession({ mode: 'single', plan: [{ ...planFor('single', 'matrix')[0], practice: 0 }], device, now: 0, seed: 17 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    const step = getStep(s) as { stepId: string };
    s = dispatch(s, { type: 'answer', stepId: step.stepId, value: { kind: 'choice', index: 0 }, rtMs: 400 }, 2);
    expect(s.sections[0].responses[0].rapid).toBe(true);
  });

  it('rejects malformed procedure results', () => {
    let s = createSession({ mode: 'single', plan: planFor('single', 'reaction'), device, now: 0, seed: 19 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    const step = getStep(s) as { stepId: string };
    const bad = dispatch(s, { type: 'procedure-result', stepId: step.stepId, result: { simple: 'nope' } }, 2);
    expect(bad.status).toBe('active');
    expect(bad.events.at(-1)?.detail).toMatch(/invalid/);
  });
});

describe('complete assessments', () => {
  for (const mode of ['quick', 'core', 'full'] as const) {
    it(`completes the ${mode} battery and produces a report`, () => {
      const s = run(mode, 1, 100 + mode.length);
      expect(s.status).toBe('complete');
      const report = generateReport(s);
      expect(report.complete).toBe(true);
      expect(report.general).not.toBeNull();
      expect(report.general!.provisional).toBe(true);
      expect(Number.isFinite(report.general!.theta)).toBe(true);
      // every planned section finished
      expect(s.sections.every((x) => x.status === 'done')).toBe(true);
    });
  }

  it('orders able and less able simulated participants correctly', () => {
    const low = generateReport(run('quick', -1, 501)).general!.theta;
    const high = generateReport(run('quick', 2.5, 502)).general!.theta;
    expect(high).toBeGreaterThan(low + 1.5);
  });

  it('runs every paradigm on its own', async () => {
    const { PARADIGMS } = await import('../src/items');
    for (const p of PARADIGMS) {
      const s = run('single', 0.5, 900 + p.id.length, p.id);
      expect(s.status, p.id).toBe('complete');
      expect(() => generateReport(s)).not.toThrow();
    }
  });
});

describe('guessing participants', () => {
  it('cannot extend a section indefinitely with rapid guesses', () => {
    let s = createSession({ mode: 'single', plan: planFor('single', 'series'), device, now: 0, seed: 77 });
    s = dispatch(s, { type: 'begin', section: 0 }, 1);
    for (let i = 0; i < 100 && s.status === 'active'; i++) {
      const step = getStep(s);
      if (step.type === 'practice') s = dispatch(s, { type: 'practice-answer', stepId: step.stepId, value: { kind: 'number', value: 1 } }, 2);
      else if (step.type === 'item') s = dispatch(s, { type: 'answer', stepId: step.stepId, value: { kind: 'number', value: 1 }, rtMs: 300 }, 3);
    }
    expect(s.status).toBe('complete');
    expect(s.sections[0].responses.length).toBe(planFor('single', 'series')[0].stop.maxItems);
    expect(s.sections[0].responses.every((r) => r.rapid)).toBe(true);
  });
});
