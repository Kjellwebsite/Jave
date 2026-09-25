/**
 * Balance systems. Symbols carry hidden positive integer weights; balanced scales
 * constrain them. The question asks how many unit symbols balance a given pan.
 * Every item is checked by exact rational Gaussian elimination with the unit
 * weight fixed at 1: all weights must be determined and the answer an integer.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';
import { gcd } from '../../utils/math';

export type BalanceSymbol = 'circle' | 'triangle' | 'square' | 'hexagon';
export type Pan = Partial<Record<BalanceSymbol, number>>;

export interface BalanceContent {
  scales: { left: Pan; right: Pan }[];
  question: { lhs: Pan; unit: BalanceSymbol };
}

export const BALANCE_SYMBOLS: readonly BalanceSymbol[] = ['circle', 'triangle', 'square', 'hexagon'];

const MAX_PER_SYMBOL = 6;
const MAX_PER_PAN = 8;

/* Exact rationals on small integers. */
interface Frac {
  n: number;
  d: number;
}

const frac = (n: number, d = 1): Frac => {
  if (d === 0) throw new Error('balance: division by zero');
  const g = gcd(n, d) || 1;
  const s = d < 0 ? -1 : 1;
  return { n: (s * n) / g, d: (s * d) / g };
};
const fsub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const fadd = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const fmul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const fdiv = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n);
const isZero = (a: Frac) => a.n === 0;

const count = (p: Pan, s: BalanceSymbol) => p[s] ?? 0;
const symbolsOf = (p: Pan) => BALANCE_SYMBOLS.filter((s) => count(p, s) > 0);
const panTotal = (p: Pan) => BALANCE_SYMBOLS.reduce((t, s) => t + count(p, s), 0);

/** Net coefficients left − right. */
function net(scale: { left: Pan; right: Pan }): Map<BalanceSymbol, number> {
  const m = new Map<BalanceSymbol, number>();
  for (const s of BALANCE_SYMBOLS) {
    const v = count(scale.left, s) - count(scale.right, s);
    if (v !== 0) m.set(s, v);
  }
  return m;
}

/**
 * Weights relative to `unit` (unit = 1), or null when the scales are inconsistent
 * or leave any weight of a symbol in the system undetermined.
 */
export function solveBalanceWeights(content: BalanceContent): Map<BalanceSymbol, Frac> | null {
  const { scales, question } = content;
  const used = new Set<BalanceSymbol>([question.unit, ...symbolsOf(question.lhs)]);
  for (const sc of scales) for (const s of [...symbolsOf(sc.left), ...symbolsOf(sc.right)]) used.add(s);
  const vars = BALANCE_SYMBOLS.filter((s) => used.has(s) && s !== question.unit);
  const rows: Frac[][] = scales.map((sc) => {
    const nt = net(sc);
    return [...vars.map((v) => frac(nt.get(v) ?? 0)), frac(-(nt.get(question.unit) ?? 0))];
  });
  const nv = vars.length;
  let r = 0;
  const pivots: number[] = [];
  for (let c = 0; c < nv && r < rows.length; c++) {
    const p = rows.findIndex((row, i) => i >= r && !isZero(row[c]));
    if (p < 0) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const pv = rows[r][c];
    rows[r] = rows[r].map((x) => fdiv(x, pv));
    for (let i = 0; i < rows.length; i++) {
      if (i === r || isZero(rows[i][c])) continue;
      const f = rows[i][c];
      rows[i] = rows[i].map((x, j) => fsub(x, fmul(f, rows[r][j])));
    }
    pivots.push(c);
    r++;
  }
  for (let i = r; i < rows.length; i++) if (!isZero(rows[i][nv])) return null;
  if (pivots.length < nv) return null;
  const w = new Map<BalanceSymbol, Frac>([[question.unit, frac(1)]]);
  pivots.forEach((c, i) => w.set(vars[c], rows[i][nv]));
  return w;
}

/** Exact answer to the question, or null when it is not determined by the scales. */
export function solveBalance(content: BalanceContent): { n: number; d: number } | null {
  const w = solveBalanceWeights(content);
  if (!w) return null;
  let total = frac(0);
  for (const s of symbolsOf(content.question.lhs)) {
    const ws = w.get(s);
    if (!ws) return null;
    total = fadd(total, fmul(frac(count(content.question.lhs, s)), ws));
  }
  return total;
}

/** True when the question can be answered by repeatedly using a scale with a single unknown symbol. */
export function substitutionSolvable(content: BalanceContent): boolean {
  const known = new Set<BalanceSymbol>([content.question.unit]);
  const nets = content.scales.map(net);
  let changed = true;
  while (changed) {
    changed = false;
    for (const nt of nets) {
      const unknown = [...nt.keys()].filter((s) => !known.has(s));
      if (unknown.length === 1 && nt.size > 1) {
        known.add(unknown[0]);
        changed = true;
      }
    }
  }
  return symbolsOf(content.question.lhs).every((s) => known.has(s));
}

const isMixed = (sc: { left: Pan; right: Pan }) => symbolsOf(sc.left).some((s) => count(sc.right, s) > 0);

/** A scale whose net relation is a multiple of "lhs = answer × unit" states the answer directly. */
function statesAnswer(sc: { left: Pan; right: Pan }, q: BalanceContent['question'], answer: number): boolean {
  const nt = net(sc);
  const target = new Map<BalanceSymbol, number>();
  for (const s of symbolsOf(q.lhs)) target.set(s, count(q.lhs, s));
  target.set(q.unit, (target.get(q.unit) ?? 0) - answer);
  let ratio: Frac | null = null;
  for (const s of BALANCE_SYMBOLS) {
    const a = nt.get(s) ?? 0;
    const b = target.get(s) ?? 0;
    if (a === 0 && b === 0) continue;
    if (a === 0 || b === 0) return false;
    const r = frac(a, b);
    if (ratio && (ratio.n !== r.n || ratio.d !== r.d)) return false;
    ratio = r;
  }
  return ratio !== null;
}

interface LevelDef {
  level: number;
  unknowns: number;
  scales: number;
  feature: string;
}

const LEVEL_DEFS: LevelDef[] = [
  { level: 1, unknowns: 2, scales: 1, feature: 'direct reading' },
  { level: 2, unknowns: 2, scales: 2, feature: 'one substitution' },
  { level: 3, unknowns: 3, scales: 2, feature: 'chain substitution' },
  { level: 4, unknowns: 3, scales: 3, feature: 'mixed pans' },
  { level: 5, unknowns: 3, scales: 3, feature: 'elimination' },
  { level: 6, unknowns: 4, scales: 3, feature: 'elimination, multiple' },
  { level: 7, unknowns: 4, scales: 4, feature: 'mixed pans and elimination' },
  { level: 8, unknowns: 4, scales: 4, feature: 'composite question' },
];

type Vec = number[];

const pan = (syms: BalanceSymbol[], v: Vec): Pan => {
  const p: Pan = {};
  syms.forEach((s, i) => {
    if (v[i] > 0) p[s] = v[i];
  });
  return p;
};

/** All count vectors with 0..6 of each symbol and at most MAX_PER_PAN in total, grouped by weight. */
function vectorsByWeight(weights: number[]): Map<number, Vec[]> {
  const out = new Map<number, Vec[]>();
  const k = weights.length;
  const v: Vec = new Array(k).fill(0);
  const rec = (i: number, total: number, w: number) => {
    if (i === k) {
      if (total === 0) return;
      const list = out.get(w) ?? [];
      list.push(v.slice());
      out.set(w, list);
      return;
    }
    for (let c = 0; c <= MAX_PER_SYMBOL && total + c <= MAX_PER_PAN; c++) {
      v[i] = c;
      rec(i + 1, total + c, w + c * weights[i]);
    }
    v[i] = 0;
  };
  rec(0, 0, 0);
  return out;
}

const dot = (a: Vec, b: Vec) => a.reduce((t, x, i) => t + x * b[i], 0);

function randomScale(rng: Rng, weights: number[], buckets: Map<number, Vec[]>, mixed: boolean, minCover: number): { l: Vec; r: Vec } | null {
  const k = weights.length;
  for (let tries = 0; tries < 40; tries++) {
    const types = rng.int(1, Math.min(minCover > 2 ? 2 : 3, k - 1));
    const chosen = rng.sample(
      Array.from({ length: k }, (_, i) => i),
      types,
    );
    const l: Vec = new Array(k).fill(0);
    for (const i of chosen) l[i] = rng.int(1, 3);
    const cands = (buckets.get(dot(l, weights)) ?? []).filter((r) => {
      const shared = r.some((c, i) => c > 0 && l[i] > 0);
      if (shared !== mixed) return false;
      if (r.every((c, i) => c === l[i])) return false;
      return r.filter((c, i) => c > 0 || l[i] > 0).length >= minCover;
    });
    if (cands.length) return { l, r: rng.pick(cands) };
  }
  return null;
}

export interface GeneratedBalance {
  content: BalanceContent;
  key: number;
  weights: Partial<Record<BalanceSymbol, number>>;
}

function finalize(
  rng: Rng,
  syms: BalanceSymbol[],
  weights: number[],
  scales: { l: Vec; r: Vec }[],
  lhs: Vec,
  unit: number,
): { content: BalanceContent; answer: number } {
  const content: BalanceContent = {
    scales: rng.shuffle(scales).map(({ l, r }) => (rng.chance(0.5) ? { left: pan(syms, l), right: pan(syms, r) } : { left: pan(syms, r), right: pan(syms, l) })),
    question: { lhs: pan(syms, lhs), unit: syms[unit] },
  };
  return { content, answer: dot(lhs, weights) / weights[unit] };
}

function attempt(def: LevelDef, rng: Rng): GeneratedBalance | null {
  const syms = rng.sample(BALANCE_SYMBOLS, def.unknowns);
  const k = def.unknowns;
  let weights: number[];
  let scales: { l: Vec; r: Vec }[] = [];
  let lhs: Vec;
  const unit = 0;
  const unitVec = (i: number, c = 1) => Array.from({ length: k }, (_, j) => (j === i ? c : 0));

  if (def.level <= 3) {
    const n = rng.int(2, def.level === 2 ? 5 : 6);
    const wu = rng.int(1, 3);
    if (def.level === 1) {
      weights = [wu, n * wu];
      scales = [{ l: unitVec(1), r: unitVec(0, n) }];
      lhs = unitVec(1);
    } else if (def.level === 2) {
      const j = rng.int(1, MAX_PER_SYMBOL - n);
      const p = rng.int(2, 4);
      weights = [wu, n * wu];
      scales = [
        { l: unitVec(1), r: unitVec(0, n) },
        { l: [j, 1], r: unitVec(0, n + j) },
      ];
      lhs = unitVec(1, p);
    } else {
      const m = rng.int(2, 6);
      weights = [wu, m * wu, n * m * wu];
      scales = [
        { l: unitVec(1), r: unitVec(0, m) },
        { l: unitVec(2), r: unitVec(1, n) },
      ];
      lhs = unitVec(2);
    }
  } else {
    const wu = rng.int(1, 3);
    const pool = Array.from({ length: 12 }, (_, i) => i + 1).filter((x) => x !== wu);
    weights = [wu, ...rng.sample(pool, k - 1)];
    const buckets = vectorsByWeight(weights);
    const mixedCount = def.level === 4 ? rng.int(2, 3) : def.level === 7 ? rng.int(1, 2) : 0;
    for (let i = 0; i < def.scales; i++) {
      const minCover = def.level >= 5 ? 3 : 2;
      const sc = randomScale(rng, weights, buckets, i < mixedCount, minCover);
      if (!sc) return null;
      scales.push(sc);
    }
    const others = rng.shuffle(Array.from({ length: k - 1 }, (_, i) => i + 1));
    if (def.level === 8) {
      lhs = new Array(k).fill(0);
      lhs[others[0]] = rng.int(1, 3);
      lhs[others[1]] = rng.int(1, 2);
    } else {
      lhs = unitVec(others[0], def.level === 6 ? rng.int(2, 4) : 1);
    }
  }

  const { content, answer } = finalize(rng, syms, weights, scales, lhs, unit);
  if (!Number.isInteger(answer) || answer < 2 || answer > 60) return null;
  if (content.scales.some((sc) => panTotal(sc.left) > MAX_PER_PAN || panTotal(sc.right) > MAX_PER_PAN)) return null;
  if (content.scales.some((sc) => BALANCE_SYMBOLS.some((s) => count(sc.left, s) > MAX_PER_SYMBOL || count(sc.right, s) > MAX_PER_SYMBOL))) return null;
  const keys = content.scales.map((sc) => JSON.stringify([...net(sc)].sort()));
  if (new Set(keys).size < keys.length) return null;
  const present = new Set(content.scales.flatMap((sc) => [...symbolsOf(sc.left), ...symbolsOf(sc.right)]));
  if (present.size !== k) return null;

  const solved = solveBalance(content);
  if (!solved || solved.d !== 1 || solved.n !== answer) return null;

  if (def.level >= 3 && content.scales.some((sc) => statesAnswer(sc, content.question, answer))) return null;
  const mixed = content.scales.filter(isMixed).length;
  const subst = substitutionSolvable(content);
  if (def.level === 4 && mixed < 2) return null;
  if (def.level >= 5 && subst) return null;
  if (def.level === 7 && mixed < 1) return null;

  const w: Partial<Record<BalanceSymbol, number>> = {};
  syms.forEach((s, i) => (w[s] = weights[i]));
  return { content, key: answer, weights: w };
}

export function generateBalance(level: number, rng: Rng): GeneratedBalance {
  const def = LEVEL_DEFS.find((d) => d.level === level);
  if (!def) throw new Error(`balance: unknown level ${level}`);
  for (let i = 0; i < 400; i++) {
    const g = attempt(def, rng);
    if (g) return g;
  }
  throw new Error(`balance: could not generate level ${level}`);
}

export const BALANCE_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.6, c: 0, timeLimitMs: 60_000 },
  { level: 2, a: 1.55, b: -0.8, c: 0, timeLimitMs: 75_000 },
  { level: 3, a: 1.6, b: 0.0, c: 0, timeLimitMs: 90_000 },
  { level: 4, a: 1.65, b: 0.8, c: 0, timeLimitMs: 105_000 },
  { level: 5, a: 1.7, b: 1.5, c: 0, timeLimitMs: 120_000 },
  { level: 6, a: 1.75, b: 2.2, c: 0, timeLimitMs: 135_000 },
  { level: 7, a: 1.8, b: 2.9, c: 0, timeLimitMs: 150_000 },
  { level: 8, a: 1.85, b: 3.4, c: 0, timeLimitMs: 150_000 },
];

export const balance = generatorParadigm<BalanceContent, number>({
  id: 'balance',
  version: 1,
  domain: 'quant',
  group: 'core',
  facet: 'quantitative-relations',
  title: 'Balance systems',
  subtitle: 'Read the scales. Work out the missing weight.',
  construct: 'Quantitative relational reasoning: deriving an unknown ratio from a system of balanced equations.',
  instructions: [
    'Every scale shown is perfectly balanced.',
    'Symbols of the same shape always weigh the same.',
    'Use the scales to find how many of the named symbol balance the question pan.',
    'Answers are whole numbers. Type the number and press Enter.',
  ],
  minutes: 6,
  minRtMs: 3000,
  levels: BALANCE_LEVELS,
  practiceLevels: [1, 3],
  generate(level, rng) {
    const { content, key, weights } = generateBalance(level, rng);
    const def = LEVEL_DEFS.find((d) => d.level === level);
    return {
      content,
      key,
      response: { kind: 'number', min: 1, max: 99 },
      features: {
        scales: content.scales.length,
        unknowns: Object.keys(weights).length,
        feature: def?.feature ?? '',
        weights: Object.entries(weights)
          .map(([s, v]) => `${s}=${v}`)
          .join(','),
      },
      explanation: `Hidden weights: ${Object.entries(weights)
        .map(([s, v]) => `${s} ${v}`)
        .join(', ')}. Answer: ${key}.`,
    };
  },
});
