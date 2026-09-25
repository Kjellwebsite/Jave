import { describe, expect, it } from 'vitest';
import { eap } from '../src/adaptive/estimate';
import { information, probability, thetaMax } from '../src/adaptive/irt';
import { neediestFacet, selectCandidate } from '../src/adaptive/select';
import { shouldStop } from '../src/adaptive/stopping';
import { createRng } from '../src/utils/rng';

describe('3PL model', () => {
  it('has the lower asymptote c and P = (1+c)/2 at θ = b', () => {
    const p = { a: 1.5, b: 0.5, c: 0.2 };
    expect(probability(-10, p)).toBeCloseTo(0.2, 5);
    expect(probability(0.5, p)).toBeCloseTo(0.6, 10);
  });

  it('reaches maximum information at Birnbaum’s θ_max', () => {
    const p = { a: 1.2, b: 0.3, c: 0.2 };
    const tm = thetaMax(p);
    // Logistic metric (D = 1): θ_max = b + ln((1 + √(1 + 8c)) / 2) / a
    expect(tm).toBeCloseTo(0.5226, 3);
    // I_max = a² / (8(1 − c)²) · [1 − 20c − 8c² + (1 + 8c)^1.5]
    expect(information(tm, p)).toBeCloseTo(0.2454, 3);
    expect(information(tm, p)).toBeGreaterThan(information(tm - 0.05, p));
    expect(information(tm, p)).toBeGreaterThan(information(tm + 0.05, p));
  });

  it('reduces to a²/4 at θ = b for the 2PL', () => {
    const p = { a: 2, b: 1, c: 0 };
    expect(information(1, p)).toBeCloseTo(1, 10);
  });
});

describe('EAP estimation', () => {
  it('returns the prior mean with no data and finite values for extreme patterns', () => {
    // The grid runs from −4 to +6, so the truncated prior mean sits a hair above 0.
    expect(eap([]).theta).toBeCloseTo(0, 2);
    const allRight = eap(Array.from({ length: 10 }, (_, i) => ({ irt: { a: 1.6, b: i * 0.4, c: 0 }, correct: true })));
    expect(Number.isFinite(allRight.theta)).toBe(true);
    expect(allRight.theta).toBeGreaterThan(2.5);
    const allWrong = eap(Array.from({ length: 10 }, () => ({ irt: { a: 1.6, b: 0, c: 0.25 }, correct: false })));
    expect(allWrong.theta).toBeLessThan(-1);
  });

  it('shrinks SE as items accumulate', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ irt: { a: 1.7, b: (i % 5) - 2, c: 0 }, correct: i % 2 === 0 }));
    expect(eap(items.slice(0, 12)).se).toBeLessThan(eap(items.slice(0, 3)).se);
  });
});

describe('item selection', () => {
  const levels = [-2, -1, 0, 1, 2, 3].map((b, i) => ({ key: String(i), irt: { a: 1.6, b, c: 0 } }));

  it('picks items near the current estimate', () => {
    const rng = createRng(1);
    const pick = selectCandidate(1.1, levels, rng, { topK: 1, withinShare: 0.85 });
    expect(pick?.irt.b).toBe(1);
  });

  it('limits early jumps', () => {
    const pick = selectCandidate(3, levels, createRng(2), { topK: 1, withinShare: 0.85, previousB: 0, maxStep: 1.5 });
    expect(pick!.irt.b).toBeLessThanOrEqual(2);
  });

  it('balances facets by deficit', () => {
    expect(neediestFacet({ a: 0.5, b: 0.5 }, { a: 3, b: 1 }, new Set(['a', 'b']))).toBe('b');
  });

  it('prefers unseen items but falls back when all are seen', () => {
    const rng = createRng(3);
    const seen = new Set(['0', '1', '2', '3', '4']);
    expect(selectCandidate(0, levels, rng, { topK: 1, withinShare: 0.85, avoid: seen })?.key).toBe('5');
    expect(selectCandidate(0, levels.slice(0, 2), rng, { topK: 1, withinShare: 0.85, avoid: new Set(['0', '1']) })).not.toBeNull();
  });
});

describe('stopping rules', () => {
  const rule = { minItems: 5, maxItems: 10, seTarget: 0.4, maxMs: 60_000 };
  it('stops on precision only after the minimum length', () => {
    expect(shouldStop(rule, { theta: 0, se: 0.3, n: 4 }, 0)).toBeNull();
    expect(shouldStop(rule, { theta: 0, se: 0.3, n: 5 }, 0)).toBe('se');
  });
  it('stops at the maximum length and at the time budget', () => {
    expect(shouldStop(rule, { theta: 0, se: 0.8, n: 10 }, 0)).toBe('max-items');
    expect(shouldStop(rule, { theta: 0, se: 0.8, n: 4 }, 61_000)).toBe('time');
  });
});

describe('CAT simulation', () => {
  it('recovers θ across the range with low bias when parameters are correct', () => {
    const bank = Array.from({ length: 12 }, (_, i) => ({ key: String(i), irt: { a: 1.7, b: -2 + i * 0.5, c: 0 } }));
    const rng = createRng(42);
    const errors: Record<string, number[]> = {};
    for (const trueTheta of [-1.5, 0, 1.5, 3]) {
      errors[trueTheta] = [];
      for (let sim = 0; sim < 150; sim++) {
        const obs: { irt: { a: number; b: number; c: number }; correct: boolean }[] = [];
        for (let k = 0; k < 14; k++) {
          const est = eap(obs);
          const item = selectCandidate(est.theta, bank, rng, { topK: 2, withinShare: 0.85 })!;
          obs.push({ irt: item.irt, correct: rng.next() < probability(trueTheta, item.irt) });
        }
        errors[trueTheta].push(eap(obs).theta - trueTheta);
      }
    }
    for (const [t, errs] of Object.entries(errors)) {
      const bias = errs.reduce((s, e) => s + e, 0) / errs.length;
      const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
      // Mild shrinkage toward the prior is expected at the extremes (Bock & Mislevy, 1982).
      expect(Math.abs(bias), `bias at θ=${t}`).toBeLessThan(Number(t) >= 3 ? 0.45 : 0.25);
      expect(rmse, `rmse at θ=${t}`).toBeLessThan(0.6);
    }
  });
});
