import { describe, expect, it } from 'vitest';
import { analogy, ANALOGY_LEVELS, ANALOGY_OPS, applyOps, type AnalogyContent } from '../src/items/generators/analogy';
import { balance, BALANCE_LEVELS, BALANCE_SYMBOLS, solveBalance, type BalanceContent, type BalanceSymbol } from '../src/items/generators/balance';
import { probability, PROBABILITY_LEVELS, type ProbabilityContent } from '../src/items/generators/probability';
import { createRng } from '../src/utils/rng';

const SEEDS = 40;

/* ------------------------------------------------------------------ */
/* Analogy                                                              */
/* ------------------------------------------------------------------ */

/** Plain enumeration of every composition (no state merging), for an independent check. */
function bruteForce(content: AnalogyContent, maxOps: number): { length: number; outputs: Set<string> } | null {
  const froms = content.examples.map((e) => e.from);
  const tos = content.examples.map((e) => e.to);
  for (let len = 1; len <= maxOps; len++) {
    const outputs = new Set<string>();
    const rec = (depth: number, xs: string[], qv: string | null) => {
      if (depth === len) {
        if (xs.every((x, i) => x === tos[i])) outputs.add(qv ?? '<undefined>');
        return;
      }
      for (const op of ANALOGY_OPS) {
        const next: string[] = [];
        let ok = true;
        for (const x of xs) {
          const y = op.apply(x);
          if (y === null) {
            ok = false;
            break;
          }
          next.push(y);
        }
        if (ok) rec(depth + 1, next, qv === null ? null : op.apply(qv));
      }
    };
    rec(0, froms, content.query);
    if (outputs.size) return { length: len, outputs };
  }
  return null;
}

const ANALOGY_SHAPE: Record<number, { ops: number; examples: number; conditional: boolean }> = {
  1: { ops: 1, examples: 1, conditional: false },
  2: { ops: 1, examples: 1, conditional: false },
  3: { ops: 2, examples: 2, conditional: false },
  4: { ops: 2, examples: 1, conditional: false },
  5: { ops: 3, examples: 2, conditional: false },
  6: { ops: 3, examples: 2, conditional: true },
  7: { ops: 3, examples: 1, conditional: false },
  8: { ops: 4, examples: 2, conditional: true },
};

describe('analogy generator', () => {
  it('produces items whose key is the unique output of every minimal consistent composition', () => {
    for (const { level } of ANALOGY_LEVELS) {
      const shape = ANALOGY_SHAPE[level];
      for (let s = 0; s < SEEDS; s++) {
        const item = analogy.instantiate(String(level), createRng(10_000 + level * 101 + s));
        const content = item.content as AnalogyContent;
        const key = item.key as string;
        const ops = String(item.features.ops).split('>');
        expect(ops).toHaveLength(shape.ops);
        expect(content.examples).toHaveLength(shape.examples);
        if (shape.conditional) expect(item.features.conditional).toBe(true);
        for (const e of content.examples) {
          expect(applyOps(ops, e.from)).toBe(e.to);
          expect(e.from).not.toBe(e.to);
        }
        expect(applyOps(ops, content.query)).toBe(key);
        expect(key).not.toBe(content.query);
        for (const str of [content.query, ...content.examples.map((e) => e.from)]) {
          expect(str).toMatch(/^[a-z]{3,7}$/);
        }
        expect(key).toMatch(/^[a-z]{1,16}$/);
        const bf = bruteForce(content, shape.ops);
        expect(bf).not.toBeNull();
        expect(bf!.length).toBe(shape.ops);
        expect([...bf!.outputs]).toEqual([key]);
      }
    }
  });

  it('is deterministic given the seed', () => {
    const a = analogy.instantiate('5', createRng(42));
    const b = analogy.instantiate('5', createRng(42));
    expect(a).toEqual(b);
  });
});

/* ------------------------------------------------------------------ */
/* Balance                                                              */
/* ------------------------------------------------------------------ */

const BALANCE_SHAPE: Record<number, { unknowns: number; scales: number }> = {
  1: { unknowns: 2, scales: 1 },
  2: { unknowns: 2, scales: 2 },
  3: { unknowns: 3, scales: 2 },
  4: { unknowns: 3, scales: 3 },
  5: { unknowns: 3, scales: 3 },
  6: { unknowns: 4, scales: 3 },
  7: { unknowns: 4, scales: 4 },
  8: { unknowns: 4, scales: 4 },
};

type Pan = Partial<Record<BalanceSymbol, number>>;
const weigh = (p: Pan, w: Record<string, number>) => Object.entries(p).reduce((t, [s, c]) => t + (c ?? 0) * w[s], 0);

/** Floating-point rank of the net-coefficient matrix. */
function rank(rows: number[][]): number {
  const m = rows.map((r) => r.slice());
  let r = 0;
  const cols = m[0]?.length ?? 0;
  for (let c = 0; c < cols && r < m.length; c++) {
    let p = r;
    for (let i = r + 1; i < m.length; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    if (Math.abs(m[p][c]) < 1e-9) continue;
    [m[r], m[p]] = [m[p], m[r]];
    for (let i = 0; i < m.length; i++) {
      if (i === r) continue;
      const f = m[i][c] / m[r][c];
      for (let j = c; j < cols; j++) m[i][j] -= f * m[r][j];
    }
    r++;
  }
  return r;
}

describe('balance generator', () => {
  it('produces determined systems whose integer answer matches the exact solver', () => {
    for (const { level } of BALANCE_LEVELS) {
      const shape = BALANCE_SHAPE[level];
      for (let s = 0; s < SEEDS; s++) {
        const item = balance.instantiate(String(level), createRng(20_000 + level * 101 + s));
        const content = item.content as BalanceContent;
        const key = item.key as number;
        const w: Record<string, number> = Object.fromEntries(
          String(item.features.weights)
            .split(',')
            .map((kv) => kv.split('='))
            .map(([k, v]) => [k, Number(v)]),
        );
        const syms = Object.keys(w) as BalanceSymbol[];
        expect(syms).toHaveLength(shape.unknowns);
        expect(content.scales).toHaveLength(shape.scales);
        for (const sc of content.scales) {
          expect(weigh(sc.left, w)).toBe(weigh(sc.right, w));
          for (const c of [...Object.values(sc.left), ...Object.values(sc.right)]) expect(c).toBeLessThanOrEqual(6);
        }
        const expected = weigh(content.question.lhs, w) / w[content.question.unit];
        expect(Number.isInteger(key)).toBe(true);
        expect(key).toBe(expected);
        expect(key).toBeGreaterThanOrEqual(1);
        expect(key).toBeLessThanOrEqual(60);
        expect(solveBalance(content)).toEqual({ n: key, d: 1 });
        // Null space of dimension one: every weight ratio is fixed by the scales.
        const rows = content.scales.map((sc) => syms.map((sy) => (sc.left[sy] ?? 0) - (sc.right[sy] ?? 0)));
        expect(rank(rows)).toBe(syms.length - 1);
        if (level >= 3) {
          for (const sc of content.scales) {
            for (const [a, b] of [
              [sc.left, sc.right],
              [sc.right, sc.left],
            ]) {
              const direct = JSON.stringify(a) === JSON.stringify(content.question.lhs) && JSON.stringify(b) === JSON.stringify({ [content.question.unit]: key });
              expect(direct).toBe(false);
            }
          }
        }
        if (level === 8) expect(Object.keys(content.question.lhs).length).toBeGreaterThanOrEqual(2);
        expect(BALANCE_SYMBOLS).toContain(content.question.unit);
      }
    }
  });

  it('rejects an underdetermined system', () => {
    const content: BalanceContent = {
      scales: [{ left: { circle: 1, triangle: 1 }, right: { square: 2 } }],
      question: { lhs: { circle: 1 }, unit: 'square' },
    };
    expect(solveBalance(content)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Probability                                                          */
/* ------------------------------------------------------------------ */

const num = (s: string) => Number(s.replace('%', '').replace('−', '-'));
const nums = (s: string) => s.split(',').map(Number);

/** Independent floating-point recomputation of the answer from the item features. */
function expectedProbability(f: Record<string, number | string | boolean>): number {
  switch (f.type) {
    case 'single event': {
      const c = nums(String(f.counts));
      const t = nums(String(f.targets));
      return t.reduce((a, i) => a + c[i], 0) / (c[0] + c[1] + c[2]);
    }
    case 'complement': {
      const none = nums(String(f.ps)).reduce((a, p) => a * (1 - p / 100), 1);
      return f.variant === 'none' ? none : 1 - none;
    }
    case 'conditional frequencies':
      return Number(f.dA) / (Number(f.dA) + Number(f.dB));
    case 'without replacement': {
      const N = Number(f.N);
      const g = Number(f.g);
      if (f.variant === 'both') return (g / N) * ((g - 1) / (N - 1));
      if (f.variant === 'one') return (g / N) * ((N - g) / (N - 1)) + ((N - g) / N) * (g / (N - 1));
      return (g / N) * ((g - 1) / (N - 1)) * ((g - 2) / (N - 2));
    }
    case 'bayes': {
      const [p, h, fa] = [Number(f.p) / 100, Number(f.h) / 100, Number(f.f) / 100];
      return (p * h) / (p * h + (1 - p) * fa);
    }
    case 'sequential bayes': {
      const p = Number(f.p) / 100;
      const lik1 = (Number(f.h1) / 100) * (Number(f.h2) / 100);
      const lik0 = (Number(f.f1) / 100) * (Number(f.f2) / 100);
      return (p * lik1) / (p * lik1 + (1 - p) * lik0);
    }
    case 'dependent conditional': {
      const r = Number(f.r);
      const b = Number(f.b);
      const N = r + b;
      const rr = (r / N) * ((r - 1) / (N - 1));
      const bb = (b / N) * ((b - 1) / (N - 1));
      if (f.variant === 'atLeastOne') return rr / (1 - bb);
      if (f.variant === 'same') return rr / (rr + bb);
      // P(first red | second red) = P(both red) / P(second red), and P(second red) = r/N.
      return rr / (r / N);
    }
    default:
      throw new Error(`no percentage answer for ${String(f.type)}`);
  }
}

describe('probability generator', () => {
  it('keys the independently recomputed answer among five distinct, separated options', () => {
    for (const { level } of PROBABILITY_LEVELS) {
      for (let s = 0; s < SEEDS; s++) {
        const item = probability.instantiate(String(level), createRng(30_000 + level * 101 + s));
        const content = item.content as ProbabilityContent;
        const key = item.key as number;
        const f = item.features;
        expect(content.options).toHaveLength(5);
        expect(new Set(content.options).size).toBe(5);
        expect(key).toBeGreaterThanOrEqual(0);
        expect(key).toBeLessThan(5);
        expect(item.irt.c).toBe(0.2);
        const keyText = content.options[key];

        if (f.type === 'expected value') {
          const parse = (x: string) => x.split(',').map((pair) => pair.split(':').map(Number) as [number, number]);
          const evOf = (x: string) => parse(x).reduce((t, [p, v]) => t + (p / 100) * v, 0);
          const evA = evOf(String(f.A));
          const evB = evOf(String(f.B));
          const expected =
            Math.abs(evA - evB) < 1e-9 ? 'Both options have the same expected value.' : evA > evB ? 'Option A has the higher expected value.' : 'Option B has the higher expected value.';
          expect(keyText).toBe(expected);
          for (const o of content.options) {
            const m = /expected value of Option ([AB]) is (\S+) points/.exec(o);
            if (!m) continue;
            const truth = m[1] === 'A' ? evA : evB;
            expect(Math.abs(num(m[2]) - truth)).toBeGreaterThanOrEqual(1);
          }
          continue;
        }

        if (f.type === 'simpson') {
          const arm = (x: string) => x.split(',').map((sn) => sn.split('/').map(Number));
          const w = arm(String(f.w));
          const l = arm(String(f.l));
          for (const g of [0, 1]) expect(w[g][0] / w[g][1] - l[g][0] / l[g][1]).toBeGreaterThanOrEqual(0.02);
          const oW = (w[0][0] + w[1][0]) / (w[0][1] + w[1][1]);
          const oL = (l[0][0] + l[1][0]) / (l[0][1] + l[1][1]);
          expect(Math.abs(oW - oL)).toBeGreaterThanOrEqual(0.02);
          expect(keyText.startsWith(`${String(f.winner)} has the higher success rate in each group`)).toBe(true);
          expect(keyText.includes(', but ')).toBe(oL > oW);
          expect(f.paradox).toBe(oL > oW);
          continue;
        }

        const expected = expectedProbability(f);
        expect(Math.abs(num(keyText) - 100 * expected)).toBeLessThanOrEqual(0.05 + 1e-9);
        const values = content.options.map(num);
        for (let i = 0; i < 5; i++) {
          expect(content.options[i]).toMatch(/^\d{1,3}\.\d%$/);
          for (let j = i + 1; j < 5; j++) expect(Math.abs(values[i] - values[j])).toBeGreaterThanOrEqual(2 - 1e-9);
        }
      }
    }
  });

  it('places the key in every position', () => {
    const positions = new Set<number>();
    for (let s = 0; s < 60; s++) positions.add(probability.instantiate('6', createRng(s)).key as number);
    expect(positions.size).toBe(5);
  });
});
