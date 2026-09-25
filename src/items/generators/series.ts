/**
 * Sequence induction. Constructed numeric response (no guessing).
 * Each level is a rule family; items are rejected when any family of equal or
 * lower complexity also fits the shown terms but predicts a different answer.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

type Fit = (ts: number[]) => number | null;

const isInt = (x: number) => Number.isInteger(x);
const diffs = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]);
const evens = (ts: number[]) => ts.filter((_, i) => i % 2 === 0);
const odds = (ts: number[]) => ts.filter((_, i) => i % 2 === 1);

const fitArith: Fit = (ts) => {
  const d = ts[1] - ts[0];
  return ts.every((t, i) => i === 0 || t - ts[i - 1] === d) ? ts[ts.length - 1] + d : null;
};

const fitGeom: Fit = (ts) => {
  if (ts[0] === 0) return null;
  const r = ts[1] / ts[0];
  if (!isInt(r) || Math.abs(r) < 2) return null;
  return ts.every((t, i) => i === 0 || t === ts[i - 1] * r) ? ts[ts.length - 1] * r : null;
};

const fitSecond: Fit = (ts) => {
  const d = diffs(ts);
  const next = fitArith(d);
  return next === null ? null : ts[ts.length - 1] + next;
};

/** Two interleaved series, each fitted by `inner`. */
const interleaved =
  (inner: Fit): Fit =>
  (ts) => {
    const n = ts.length;
    const nextIsEven = n % 2 === 0;
    const same = nextIsEven ? evens(ts) : odds(ts);
    const other = nextIsEven ? odds(ts) : evens(ts);
    if (same.length < 3 || other.length < 3) return null;
    if (inner(other) === null) return null;
    return inner(same);
  };

const fitFib: Fit = (ts) => (ts.every((t, i) => i < 2 || t === ts[i - 1] + ts[i - 2]) ? ts[ts.length - 1] + ts[ts.length - 2] : null);

/** Alternating +p and ×q (either may come first). */
const fitCycle: Fit = (ts) => {
  for (const addFirst of [true, false]) {
    let p: number | null = null;
    let q: number | null = null;
    let ok = true;
    for (let i = 1; i < ts.length && ok; i++) {
      const isAdd = (i % 2 === 1) === addFirst;
      if (isAdd) {
        const v = ts[i] - ts[i - 1];
        if (p === null) p = v;
        else if (p !== v) ok = false;
      } else {
        if (ts[i - 1] === 0) ok = false;
        const v = ts[i] / ts[i - 1];
        if (!isInt(v) || v < 2) ok = false;
        else if (q === null) q = v;
        else if (q !== v) ok = false;
      }
    }
    if (ok && p !== null && q !== null && p !== 0) {
      const nextAdd = (ts.length % 2 === 1) === addFirst;
      return nextAdd ? ts[ts.length - 1] + p : ts[ts.length - 1] * q;
    }
  }
  return null;
};

const fitAffine: Fit = (ts) => {
  const den = ts[1] - ts[0];
  if (den === 0) return null;
  const k = (ts[2] - ts[1]) / den;
  if (!isInt(k) || Math.abs(k) < 2) return null;
  const m = ts[1] - k * ts[0];
  return ts.every((t, i) => i === 0 || t === k * ts[i - 1] + m) ? k * ts[ts.length - 1] + m : null;
};

/** Differences are consecutive squares, or ratios are consecutive integers. */
const fitPosition: Fit = (ts) => {
  const d = diffs(ts);
  const root = Math.round(Math.sqrt(Math.abs(d[0])));
  if (d.every((x, i) => x === (root + i) ** 2)) return ts[ts.length - 1] + (root + d.length) ** 2;
  if (ts.every((t) => t !== 0)) {
    const r = ts.slice(1).map((t, i) => t / ts[i]);
    if (r.every(isInt) && r.every((x, i) => i === 0 || x === r[i - 1] + 1)) return ts[ts.length - 1] * (r[r.length - 1] + 1);
  }
  // aₙ = aₙ₋₁·n − m, where n runs 2, 3, …
  return null;
};

const fitDiffGeom: Fit = (ts) => {
  const d = diffs(ts);
  const next = fitGeom(d);
  return next === null ? null : ts[ts.length - 1] + next;
};

/** aₙ = α·aₙ₋₁ + β·aₙ₋₂ with small integer weights, or tribonacci. */
const fitWeighted: Fit = (ts) => {
  if (ts.length < 5) return null;
  if (ts.every((t, i) => i < 3 || t === ts[i - 1] + ts[i - 2] + ts[i - 3])) {
    const n = ts.length;
    return ts[n - 1] + ts[n - 2] + ts[n - 3];
  }
  for (let alpha = 1; alpha <= 3; alpha++)
    for (let beta = -2; beta <= 3; beta++) {
      if (beta === 0 || (alpha === 1 && beta === 1)) continue;
      if (ts.every((t, i) => i < 2 || t === alpha * ts[i - 1] + beta * ts[i - 2])) {
        const n = ts.length;
        return alpha * ts[n - 1] + beta * ts[n - 2];
      }
    }
  return null;
};

/** Differences themselves follow an operation cycle or a Fibonacci rule. */
const fitNested: Fit = (ts) => {
  const d = diffs(ts);
  if (d.length < 4) return null;
  const next = fitCycle(d) ?? fitFib(d);
  return next === null ? null : ts[ts.length - 1] + next;
};

interface Family {
  level: number;
  name: string;
  shown: number;
  fit: Fit;
  gen(rng: Rng): number[];
}

const extend = (start: number[], n: number, step: (ts: number[], i: number) => number) => {
  const ts = start.slice();
  while (ts.length < n) ts.push(step(ts, ts.length));
  return ts;
};

const FAMILIES: Family[] = [
  {
    level: 1,
    name: 'arithmetic',
    shown: 5,
    fit: fitArith,
    gen: (rng) => {
      const d = rng.pick([3, 4, 6, 7, 8, 9, 11, 12, -4, -6, -7]);
      return extend([rng.int(2, 40) + (d < 0 ? 60 : 0)], 6, (ts) => ts[ts.length - 1] + d);
    },
  },
  {
    level: 2,
    name: 'geometric',
    shown: 5,
    fit: fitGeom,
    gen: (rng) => {
      const r = rng.pick([2, 3]);
      return extend([rng.int(1, 7)], 6, (ts) => ts[ts.length - 1] * r);
    },
  },
  {
    level: 3,
    name: 'second-order',
    shown: 6,
    fit: fitSecond,
    gen: (rng) => {
      let d = rng.int(1, 6);
      const k = rng.pick([2, 3, 4, 5]);
      return extend([rng.int(1, 20)], 7, (ts) => {
        const v = ts[ts.length - 1] + d;
        d += k;
        return v;
      });
    },
  },
  {
    level: 4,
    name: 'interleaved',
    shown: 7,
    fit: interleaved(fitArith),
    gen: (rng) => {
      const d1 = rng.pick([2, 3, 5, 7]);
      const d2 = rng.pick([-3, -2, 4, 6, 9]);
      const a = rng.int(1, 20);
      const b = rng.int(30, 60);
      return Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? a + (i / 2) * d1 : b + ((i - 1) / 2) * d2));
    },
  },
  {
    level: 5,
    name: 'additive recurrence',
    shown: 6,
    fit: fitFib,
    gen: (rng) => extend([rng.int(1, 6), rng.int(2, 9)], 7, (ts) => ts[ts.length - 1] + ts[ts.length - 2]),
  },
  {
    level: 6,
    name: 'operation cycle',
    shown: 6,
    fit: fitCycle,
    gen: (rng) => {
      const p = rng.pick([1, 2, 3, 4, 5, -1, -2]);
      const q = rng.pick([2, 3]);
      const addFirst = rng.chance(0.5);
      return extend([rng.int(2, 6)], 7, (ts, i) => ((i % 2 === 1) === addFirst ? ts[i - 1] + p : ts[i - 1] * q));
    },
  },
  {
    level: 7,
    name: 'affine recurrence',
    shown: 5,
    fit: fitAffine,
    gen: (rng) => {
      const k = rng.pick([2, 3, -2]);
      const m = rng.pick([-3, -2, -1, 1, 2, 3, 4, 5]);
      return extend([rng.int(1, 6)], 6, (ts) => k * ts[ts.length - 1] + m);
    },
  },
  {
    level: 8,
    name: 'position-dependent',
    shown: 6,
    fit: fitPosition,
    gen: (rng) => {
      if (rng.chance(0.5)) {
        const s = rng.int(1, 4);
        return extend([rng.int(1, 30)], 7, (ts, i) => ts[i - 1] + (s + i - 1) ** 2);
      }
      const s = rng.int(1, 3);
      return extend([rng.int(1, 4)], 7, (ts, i) => ts[i - 1] * (s + i));
    },
  },
  {
    level: 9,
    name: 'geometric differences',
    shown: 6,
    fit: fitDiffGeom,
    gen: (rng) => {
      const r = rng.pick([2, 3]);
      let d = rng.pick([1, 2, 3, 5]);
      return extend([rng.int(1, 30)], 7, (ts) => {
        const v = ts[ts.length - 1] + d;
        d *= r;
        return v;
      });
    },
  },
  {
    level: 10,
    name: 'interleaved second-order',
    shown: 9,
    fit: interleaved(fitSecond),
    gen: (rng) => {
      const make = (start: number, d0: number, k: number) => extend([start], 5, (ts, i) => ts[i - 1] + d0 + k * (i - 1));
      const a = make(rng.int(1, 10), rng.int(1, 4), rng.pick([1, 2, 3]));
      const b = make(rng.int(20, 50), rng.pick([-1, 2, 5]), rng.pick([-2, 2, 4]));
      return Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? a[i / 2] : b[(i - 1) / 2]));
    },
  },
  {
    level: 11,
    name: 'weighted recurrence',
    shown: 7,
    fit: fitWeighted,
    gen: (rng) => {
      if (rng.chance(0.4)) return extend([rng.int(0, 2), rng.int(1, 3), rng.int(2, 4)], 8, (ts) => ts[ts.length - 1] + ts[ts.length - 2] + ts[ts.length - 3]);
      const alpha = rng.pick([1, 2]);
      const beta = rng.pick(alpha === 1 ? [2, 3, -1] : [1, -1, 2]);
      return extend([rng.int(1, 4), rng.int(2, 6)], 8, (ts) => alpha * ts[ts.length - 1] + beta * ts[ts.length - 2]);
    },
  },
  {
    level: 12,
    name: 'nested differences',
    shown: 7,
    fit: fitNested,
    gen: (rng) => {
      if (rng.chance(0.5)) {
        const p = rng.pick([1, 2, 3]);
        const q = 2;
        const diffsSeq = extend([rng.int(1, 4)], 7, (ds, i) => (i % 2 === 1 ? ds[i - 1] + p : ds[i - 1] * q));
        return extend([rng.int(1, 20)], 8, (ts, i) => ts[i - 1] + diffsSeq[i - 1]);
      }
      const ds = extend([rng.int(1, 3), rng.int(2, 5)], 7, (d) => d[d.length - 1] + d[d.length - 2]);
      return extend([rng.int(1, 20)], 8, (ts, i) => ts[i - 1] + ds[i - 1]);
    },
  },
];

/** Every family at or below `level` that fits must agree with the answer. */
export function seriesAmbiguous(shown: number[], answer: number, level: number): boolean {
  for (const f of FAMILIES) {
    if (f.level > level) continue;
    const p = f.fit(shown);
    if (p !== null && p !== answer) return true;
  }
  return false;
}

export function generateSeries(level: number, rng: Rng): { shown: number[]; answer: number; family: string } {
  const family = FAMILIES.find((f) => f.level === level)!;
  for (let attempt = 0; attempt < 300; attempt++) {
    const all = family.gen(rng);
    const shown = all.slice(0, family.shown);
    const answer = all[family.shown];
    if (answer === undefined || !all.every((t) => Number.isInteger(t) && Math.abs(t) < 10_000)) continue;
    if (family.fit(shown) !== answer) continue;
    if (new Set(shown).size < shown.length - 1) continue;
    if (seriesAmbiguous(shown, answer, level)) continue;
    return { shown, answer, family: family.name };
  }
  throw new Error(`series: could not generate level ${level}`);
}

export const SERIES_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.8, c: 0, timeLimitMs: 60_000 },
  { level: 2, a: 1.5, b: -1.1, c: 0, timeLimitMs: 60_000 },
  { level: 3, a: 1.6, b: -0.4, c: 0, timeLimitMs: 75_000 },
  { level: 4, a: 1.6, b: 0.2, c: 0, timeLimitMs: 75_000 },
  { level: 5, a: 1.6, b: 0.6, c: 0, timeLimitMs: 75_000 },
  { level: 6, a: 1.7, b: 1.0, c: 0, timeLimitMs: 90_000 },
  { level: 7, a: 1.7, b: 1.5, c: 0, timeLimitMs: 90_000 },
  { level: 8, a: 1.7, b: 2.0, c: 0, timeLimitMs: 105_000 },
  { level: 9, a: 1.8, b: 2.3, c: 0, timeLimitMs: 105_000 },
  { level: 10, a: 1.8, b: 2.8, c: 0, timeLimitMs: 120_000 },
  { level: 11, a: 1.8, b: 3.3, c: 0, timeLimitMs: 135_000 },
  { level: 12, a: 1.9, b: 3.7, c: 0, timeLimitMs: 150_000 },
];

export interface SeriesContent {
  terms: number[];
}

export const series = generatorParadigm<SeriesContent, number>({
  id: 'series',
  version: 1,
  domain: 'reasoning',
  group: 'core',
  facet: 'sequence-induction',
  title: 'Sequence induction',
  subtitle: 'Find the generating rule. Type the next term.',
  construct: 'Inductive and quantitative reasoning: inferring the rule that generates a sequence.',
  instructions: [
    'Each sequence is produced by one rule. Find it and type the next number.',
    'Rules can involve differences, products, alternation, or earlier terms.',
    'All answers are whole numbers. Use the keyboard and press Enter.',
  ],
  minutes: 5,
  minRtMs: 2000,
  levels: SERIES_LEVELS,
  practiceLevels: [1, 3],
  generate(level, rng) {
    const { shown, answer, family } = generateSeries(level, rng);
    return {
      content: { terms: shown },
      key: answer,
      response: { kind: 'number', min: -99_999, max: 99_999 },
      features: { family, terms: shown.length },
      explanation: `Rule family: ${family}. Next term: ${answer}.`,
    };
  },
});
