/**
 * Relational deduction (n-term series). Premises relate nonsense-named people
 * on one or two orderings. Truth of every option is computed by enumerating all
 * orderings consistent with the premises, so the key is exact even when the
 * premises leave some relations open.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

const NAMES = ['Vell', 'Tarn', 'Osk', 'Brin', 'Kade', 'Lume', 'Miro', 'Sath', 'Dov', 'Quen', 'Rusk', 'Fenn', 'Ilo', 'Zarr'];

type Dim = 'height' | 'age';
const WORDS: Record<Dim, { more: string; less: string; notMore: string; top: string; ordinal: string }> = {
  height: { more: 'is taller than', less: 'is shorter than', notMore: 'is not taller than', top: 'tallest', ordinal: 'tallest' },
  age: { more: 'is older than', less: 'is younger than', notMore: 'is not older than', top: 'oldest', ordinal: 'oldest' },
};

interface Edge {
  dim: Dim;
  hi: number; // index of person ranked higher
  lo: number;
}

type Question =
  | { type: 'must'; options: string[] }
  | { type: 'position'; dim: Dim; rank: number; options: string[] }
  | { type: 'count'; dim: Dim; rank: number };

export interface DeductionContent {
  preface: string;
  premises: string[];
  question: string;
  q: Question;
}

interface LevelConfig {
  n: number;
  dims: Dim[];
  indeterminate: boolean;
  shuffled: boolean;
  inverted: boolean;
  negations: number;
  question: ('must' | 'position' | 'count')[];
  minTargetDistance: number;
}

const CONFIG: Record<number, LevelConfig> = {
  1: { n: 3, dims: ['height'], indeterminate: false, shuffled: false, inverted: false, negations: 0, question: ['must'], minTargetDistance: 2 },
  2: { n: 4, dims: ['height'], indeterminate: false, shuffled: true, inverted: true, negations: 0, question: ['must'], minTargetDistance: 2 },
  3: { n: 5, dims: ['height'], indeterminate: false, shuffled: true, inverted: true, negations: 0, question: ['must', 'position'], minTargetDistance: 3 },
  4: { n: 5, dims: ['height'], indeterminate: true, shuffled: true, inverted: true, negations: 0, question: ['must'], minTargetDistance: 2 },
  5: { n: 6, dims: ['height'], indeterminate: true, shuffled: true, inverted: true, negations: 2, question: ['must', 'position'], minTargetDistance: 2 },
  6: { n: 6, dims: ['height', 'age'], indeterminate: true, shuffled: true, inverted: true, negations: 1, question: ['must'], minTargetDistance: 2 },
  7: { n: 7, dims: ['height'], indeterminate: true, shuffled: true, inverted: true, negations: 2, question: ['count'], minTargetDistance: 2 },
  8: { n: 7, dims: ['height', 'age'], indeterminate: true, shuffled: true, inverted: true, negations: 2, question: ['count'], minTargetDistance: 2 },
};

export const DEDUCTION_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.6, c: 0.25, timeLimitMs: 60_000 },
  { level: 2, a: 1.5, b: -0.7, c: 0.25, timeLimitMs: 75_000 },
  { level: 3, a: 1.6, b: 0.1, c: 0.25, timeLimitMs: 90_000 },
  { level: 4, a: 1.6, b: 0.9, c: 0.25, timeLimitMs: 105_000 },
  { level: 5, a: 1.7, b: 1.6, c: 0.25, timeLimitMs: 120_000 },
  { level: 6, a: 1.7, b: 2.3, c: 0.25, timeLimitMs: 135_000 },
  { level: 7, a: 1.8, b: 3.0, c: 0, timeLimitMs: 150_000 },
  { level: 8, a: 1.8, b: 3.6, c: 0, timeLimitMs: 165_000 },
];

/** All orderings (index 0 = highest) consistent with the edges of one dimension. */
export function linearExtensions(n: number, edges: { hi: number; lo: number }[]): number[][] {
  const out: number[][] = [];
  const placed: number[] = [];
  const used = new Array(n).fill(false);
  const above = Array.from({ length: n }, () => [] as number[]);
  for (const e of edges) above[e.lo].push(e.hi);
  const rec = () => {
    if (placed.length === n) {
      out.push(placed.slice());
      return;
    }
    for (let p = 0; p < n; p++) {
      if (used[p] || !above[p].every((h) => used[h])) continue;
      used[p] = true;
      placed.push(p);
      rec();
      placed.pop();
      used[p] = false;
    }
  };
  rec();
  return out;
}

/** Undirected distance between two people in the premise graph. */
function premiseDistance(n: number, edges: Edge[], a: number, b: number): number {
  const adj = Array.from({ length: n }, () => [] as number[]);
  for (const e of edges) {
    adj[e.hi].push(e.lo);
    adj[e.lo].push(e.hi);
  }
  const dist = new Array(n).fill(Infinity);
  dist[a] = 0;
  const q = [a];
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj[u]) if (dist[v] === Infinity) {
      dist[v] = dist[u] + 1;
      q.push(v);
    }
  }
  return dist[b];
}

function buildEdges(order: number[], indeterminate: boolean, dim: Dim, rng: Rng): Edge[] {
  const rank = new Map(order.map((p, i) => [p, i]));
  if (!indeterminate) return order.slice(0, -1).map((p, i) => ({ dim, hi: p, lo: order[i + 1] }));
  // Random spanning tree whose edges agree with the hidden order.
  const nodes = rng.shuffle(order);
  const edges: Edge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i];
    const b = rng.pick(nodes.slice(0, i));
    edges.push(rank.get(a)! < rank.get(b)! ? { dim, hi: a, lo: b } : { dim, hi: b, lo: a });
  }
  return edges;
}

function statement(e: { dim: Dim; hi: number; lo: number }, names: string[], mode: 'more' | 'less' | 'not'): string {
  const w = WORDS[e.dim];
  if (mode === 'more') return `${names[e.hi]} ${w.more} ${names[e.lo]}.`;
  if (mode === 'less') return `${names[e.lo]} ${w.less} ${names[e.hi]}.`;
  return `${names[e.lo]} ${w.notMore} ${names[e.hi]}.`;
}

const ordinal = (k: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'][k];

export function generateDeduction(level: number, rng: Rng): { content: DeductionContent; key: number; features: Record<string, number | string | boolean> } {
  const cfg = CONFIG[level];
  for (let attempt = 0; attempt < 400; attempt++) {
    const names = rng.sample(NAMES, cfg.n);
    const people = Array.from({ length: cfg.n }, (_, i) => i);
    const edges: Edge[] = [];
    const exts: Record<string, number[][]> = {};
    let ok = true;
    for (const dim of cfg.dims) {
      const order = rng.shuffle(people);
      const e = buildEdges(order, cfg.indeterminate, dim, rng);
      const ext = linearExtensions(cfg.n, e);
      if (cfg.indeterminate && (ext.length < 2 || ext.length > (cfg.n <= 5 ? 30 : 120))) ok = false;
      edges.push(...e);
      exts[dim] = ext;
    }
    if (!ok) continue;

    // Necessary and possible relations.
    const necessary: Edge[] = [];
    const possibleOnly: Edge[] = [];
    for (const dim of cfg.dims) {
      const ext = exts[dim];
      for (let a = 0; a < cfg.n; a++)
        for (let b = 0; b < cfg.n; b++) {
          if (a === b) continue;
          const above = ext.filter((o) => o.indexOf(a) < o.indexOf(b)).length;
          if (above === ext.length) necessary.push({ dim, hi: a, lo: b });
          else if (above > 0) possibleOnly.push({ dim, hi: a, lo: b });
        }
    }

    // Premise wording.
    const negIdx = new Set(rng.sample(edges.map((_, i) => i), Math.min(cfg.negations, edges.length)));
    const premises = edges.map((e, i) =>
      statement(e, names, negIdx.has(i) ? 'not' : cfg.inverted && rng.chance(0.5) ? 'less' : 'more'),
    );
    const shownPremises = cfg.shuffled ? rng.shuffle(premises) : premises;
    const dimsText = cfg.dims.map((d) => (d === 'height' ? 'height' : 'age')).join(' or ');
    const preface = `No two people share the same ${dimsText}.`;

    const qType = rng.pick(cfg.question);
    const stated = new Set(edges.map((e) => `${e.dim}:${e.hi}>${e.lo}`));

    if (qType === 'must') {
      const targets = necessary.filter(
        (e) => !stated.has(`${e.dim}:${e.hi}>${e.lo}`) && premiseDistance(cfg.n, edges.filter((x) => x.dim === e.dim), e.hi, e.lo) >= cfg.minTargetDistance,
      );
      if (!targets.length) continue;
      const target = rng.pick(targets);
      const falseOnes = necessary.map((e) => ({ ...e, hi: e.lo, lo: e.hi }));
      const pool = cfg.indeterminate
        ? [...rng.shuffle(possibleOnly).slice(0, 2), ...rng.shuffle(falseOnes).slice(0, 2)]
        : rng.shuffle(falseOnes);
      const distractors: Edge[] = [];
      const seen = new Set([`${target.dim}:${target.hi}>${target.lo}`]);
      for (const d of pool) {
        const rel = `${d.dim}:${d.hi}>${d.lo}`;
        if (seen.has(rel)) continue;
        seen.add(rel);
        distractors.push(d);
        if (distractors.length === 3) break;
      }
      if (distractors.length < 3) continue;
      const optionEdges = rng.shuffle([target, ...distractors]);
      const options = optionEdges.map((e) => statement(e, names, rng.chance(0.5) ? 'more' : 'less').replace(/\.$/, ''));
      return {
        content: { preface, premises: shownPremises, question: 'Which statement must be true?', q: { type: 'must', options } },
        key: optionEdges.indexOf(target),
        features: { n: cfg.n, dims: cfg.dims.length, indeterminate: cfg.indeterminate, negations: cfg.negations, question: 'must' },
      };
    }

    const dim = rng.pick(cfg.dims);
    const ext = exts[dim];
    const rank = rng.int(0, cfg.n - 1);
    const candidates = new Set(ext.map((o) => o[rank]));

    if (qType === 'position') {
      const determined = candidates.size === 1;
      if (cfg.indeterminate && determined && rng.chance(0.6)) continue;
      const correctName = determined ? names[[...candidates][0]] : 'Cannot be determined';
      const nameOpts = rng.shuffle(determined ? people.filter((p) => !candidates.has(p)) : [...candidates]).slice(0, 3);
      if (nameOpts.length < 3 && !determined) {
        nameOpts.push(...rng.shuffle(people.filter((p) => !nameOpts.includes(p))).slice(0, 3 - nameOpts.length));
      }
      const options = rng.shuffle([...(determined ? [[...candidates][0]] : []), ...nameOpts].slice(0, 3).map((p) => names[p]));
      if (determined && !options.includes(correctName)) options[0] = correctName;
      options.push('Cannot be determined');
      return {
        content: {
          preface,
          premises: shownPremises,
          question: `Who is the ${ordinal(rank)} ${WORDS[dim].ordinal}?`,
          q: { type: 'position', dim, rank, options },
        },
        key: options.indexOf(correctName),
        features: { n: cfg.n, dims: cfg.dims.length, indeterminate: cfg.indeterminate, negations: cfg.negations, question: 'position' },
      };
    }

    // count
    if (candidates.size < 2 && rng.chance(0.7)) continue;
    return {
      content: {
        preface,
        premises: shownPremises,
        question: `How many different people could be the ${ordinal(rank)} ${WORDS[dim].ordinal}?`,
        q: { type: 'count', dim, rank },
      },
      key: candidates.size,
      features: { n: cfg.n, dims: cfg.dims.length, indeterminate: cfg.indeterminate, negations: cfg.negations, question: 'count' },
    };
  }
  throw new Error(`deduction: could not generate level ${level}`);
}

export const deduction = generatorParadigm<DeductionContent, number>({
  id: 'deduction',
  version: 1,
  domain: 'reasoning',
  group: 'core',
  facet: 'deduction',
  title: 'Relational deduction',
  subtitle: 'Integrate the premises. Decide what follows.',
  construct: 'Deductive reasoning: combining premises and separating what must be true from what only could be true.',
  instructions: [
    'Read the statements about people. They are always true.',
    'Answer only from the statements. Some questions ask what must be true, others what could be.',
    '"Not taller than" means shorter, because no two people are the same height.',
    'Later items leave some relations open. Consider every arrangement the statements allow.',
  ],
  minutes: 5,
  minRtMs: 4000,
  levels: DEDUCTION_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const { content, key, features } = generateDeduction(level, rng);
    const isCount = content.q.type === 'count';
    const optionCount = content.q.type === 'count' ? 0 : content.q.options.length;
    return {
      content,
      key,
      response: isCount ? { kind: 'number', min: 0, max: 7 } : { kind: 'choice', options: optionCount },
      features,
      explanation: isCount ? `${key} people are possible.` : `Correct option ${key + 1}.`,
    };
  },
});
