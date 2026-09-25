/**
 * Recovery simulation for the Quick battery: simulated participants answer
 * according to the 3PL model with the provisional parameters. This checks the
 * engine (selection, estimation, stopping), not the validity of the parameters.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { planFor } from '../src/engine/batteries';
import { createSession, dispatch, getStep } from '../src/engine/session';
import { registerAll } from '../src/items';
import { generateReport } from '../src/scoring/report';
import { createRng } from '../src/utils/rng';
import { answerItem, controlAnswer } from './fakes';

beforeAll(() => registerAll());

function simulate(theta: number, seed: number) {
  let s = createSession({ mode: 'quick', plan: planFor('quick'), device: { input: 'mouse', viewport: 'large', reducedMotion: false, browser: 'sim' }, now: 0, seed });
  const rng = createRng(seed * 7 + 3);
  for (let i = 0; i < 2000 && s.status === 'active'; i++) {
    const step = getStep(s);
    if (step.type === 'intro') s = dispatch(s, { type: 'begin', section: step.section }, i);
    else if (step.type === 'practice') s = dispatch(s, { type: 'practice-answer', stepId: step.stepId, value: answerItem(step.item, theta, rng) }, i);
    else if (step.type === 'item') s = dispatch(s, { type: 'answer', stepId: step.stepId, value: answerItem(step.item, theta, rng), rtMs: 20_000, aux: controlAnswer(step.item) }, i);
  }
  return generateReport(s).general!;
}

describe('quick battery recovery (model-consistent simulation)', () => {
  it('recovers the general θ across the range', () => {
    const rows: string[] = [];
    for (const theta of [-1, 0, 1, 2, 3]) {
      const est = Array.from({ length: 16 }, (_, k) => simulate(theta, 1000 * (theta + 2) + k));
      const errs = est.map((e) => e.theta - theta);
      const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
      const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
      const se = est.reduce((a, e) => a + e.se, 0) / est.length;
      const items = est.reduce((a, e) => a + e.n, 0) / est.length;
      rows.push(`θ ${theta >= 0 ? '+' : ''}${theta}: bias ${bias.toFixed(2)}, RMSE ${rmse.toFixed(2)}, mean SE ${se.toFixed(2)}, items ${items.toFixed(0)}`);
      expect(Math.abs(bias)).toBeLessThan(theta >= 3 ? 0.6 : 0.35);
      expect(rmse).toBeLessThan(0.6);
    }
    console.log(rows.join('\n'));
  }, 180_000);
});
