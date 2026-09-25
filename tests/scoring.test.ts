import { describe, expect, it } from 'vitest';
import { auroc2, brierDecomposition } from '../src/scoring/metacognition';
import { dPrime, medianRt } from '../src/scoring/performance';
import { RANK_THRESHOLDS, rankFor } from '../src/scoring/rank';
import { fitRw } from '../src/tasks/reversal';
import { checkConstraint } from '../src/tasks/creative';

describe('ranks', () => {
  it('uses the product thresholds', () => {
    expect(rankFor(3.2)).toBe('S');
    expect(rankFor(2.4)).toBe('A-');
    expect(rankFor(3.0)).toBe('A+');
    expect(rankFor(1.7)).toBe('B-');
    expect(rankFor(0.9)).toBe('C-');
    expect(rankFor(0.1)).toBe('D-');
    expect(rankFor(-0.5)).toBe('F');
    expect(RANK_THRESHOLDS).toHaveLength(14);
  });

  it('accepts a future norm table', () => {
    expect(rankFor(0, { id: 'test', toZ: (t) => t + 3.2 })).toBe('S');
  });
});

describe('metacognition', () => {
  it('computes type-2 AUROC', () => {
    expect(auroc2([0.9, 0.8, 0.2, 0.1], [true, true, false, false])).toBe(1);
    expect(auroc2([0.5, 0.5], [true, false])).toBe(0.5);
    expect(Number.isNaN(auroc2([0.5], [true]))).toBe(true);
  });

  it('decomposes the Brier score', () => {
    const conf = [0.9, 0.9, 0.6, 0.6, 0.3, 0.3];
    const out = [1, 1, 1, 0, 0, 0];
    const d = brierDecomposition(conf, out);
    // Murphy: BS = REL − RES + UNC (exact when all forecasts in a bin are equal)
    expect(d.brier).toBeCloseTo(d.reliability - d.resolution + d.uncertainty, 10);
  });
});

describe('performance metrics', () => {
  it('trims anticipations and outliers from RTs', () => {
    expect(medianRt([100, 300, 310, 320, 330, 5000])).toBeCloseTo(320, 0);
  });

  it('computes d′ with correction', () => {
    expect(dPrime(9, 10, 1, 20)).toBeGreaterThan(2);
    expect(Number.isFinite(dPrime(10, 10, 0, 20))).toBe(true);
  });

  it('recovers a Rescorla–Wagner learning rate from simulated choices', () => {
    const alpha = 0.3;
    const beta = 8;
    const q = [0.5, 0.5, 0.5];
    const probs = [0.8, 0.5, 0.2];
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const choices: number[] = [];
    const rewards: boolean[] = [];
    for (let t = 0; t < 400; t++) {
      const ex = q.map((v) => Math.exp(beta * v));
      const z = ex.reduce((a, b) => a + b, 0);
      let r = rand() * z;
      let c = 0;
      while (r > ex[c]) r -= ex[c++];
      const win = rand() < probs[c];
      choices.push(c);
      rewards.push(win);
      q[c] += alpha * ((win ? 1 : 0) - q[c]);
    }
    const fit = fitRw(choices, rewards);
    expect(fit.alpha).toBeGreaterThan(0.1);
    expect(fit.alpha).toBeLessThan(0.6);
  });
});

describe('constraint checks', () => {
  it('evaluates constrained-writing rules', () => {
    expect(checkConstraint('six small seals swim silently seaward', { kind: 'start-letter', value: 's', label: '' })).toBe(true);
    expect(checkConstraint('a b c', { kind: 'words-exact', value: 3, label: '' })).toBe(true);
    expect(checkConstraint('nothing with that', { kind: 'exclude-letter', value: 'e', label: '' })).toBe(true);
    expect(checkConstraint('gravity pulls', { kind: 'include', value: 'gravity', label: '' })).toBe(true);
    expect(checkConstraint('go go', { kind: 'no-repeat', label: '' })).toBe(false);
  });
});
