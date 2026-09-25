/**
 * Transformation analogies on letter strings: A → B, then C → ?.
 * Validity is checked by breadth-first search over compositions of primitive
 * operations. All minimal compositions consistent with the examples must map
 * the query to the key, and the minimal length must equal the intended length.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export interface AnalogyContent {
  examples: { from: string; to: string }[];
  query: string;
}

type OpKind = 'basic' | 'hard' | 'conditional';

export interface AnalogyOp {
  id: string;
  label: string;
  family: string;
  kind: OpKind;
  apply(s: string): string | null;
}

const MAX_LEN = 32;
const CODE_A = 97;
const CODE_Z = 122;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

const reverse = (s: string) => [...s].reverse().join('');

function shiftWhere(s: string, k: number, pred: (c: string, i: number) => boolean): string | null {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!pred(c, i)) {
      out += c;
      continue;
    }
    const code = c.charCodeAt(0) + k;
    if (code < CODE_A || code > CODE_Z) return null;
    out += String.fromCharCode(code);
  }
  return out;
}

const guard = (s: string | null) => (s === null || s.length === 0 || s.length > MAX_LEN ? null : s);

const shiftOp = (k: number): AnalogyOp => ({
  id: `shift${k > 0 ? '+' : ''}${k}`,
  label: `shift every letter ${k > 0 ? 'forward' : 'back'} by ${Math.abs(k)}`,
  family: 'shift',
  kind: Math.abs(k) === 1 ? 'basic' : 'hard',
  apply: (s) => shiftWhere(s, k, () => true),
});

export const ANALOGY_OPS: readonly AnalogyOp[] = [
  { id: 'reverse', label: 'reverse', family: 'reverse', kind: 'basic', apply: (s) => reverse(s) },
  { id: 'rotl', label: 'rotate left by one', family: 'rotate', kind: 'basic', apply: (s) => s.slice(1) + s[0] },
  { id: 'rotr', label: 'rotate right by one', family: 'rotate', kind: 'basic', apply: (s) => s[s.length - 1] + s.slice(0, -1) },
  ...[1, -1, 2, -2, 3, -3].map(shiftOp),
  {
    id: 'swap',
    label: 'swap the first and last letters',
    family: 'swap',
    kind: 'basic',
    apply: (s) => (s.length < 2 ? null : s[s.length - 1] + s.slice(1, -1) + s[0]),
  },
  { id: 'sort', label: 'sort alphabetically', family: 'sort', kind: 'hard', apply: (s) => [...s].sort().join('') },
  { id: 'dup', label: 'duplicate the last letter', family: 'dup', kind: 'basic', apply: (s) => guard(s + s[s.length - 1]) },
  { id: 'drop', label: 'drop the first letter', family: 'drop', kind: 'basic', apply: (s) => guard(s.slice(1)) },
  { id: 'mirror', label: 'append the reverse', family: 'mirror', kind: 'hard', apply: (s) => guard(s + reverse(s)) },
  {
    id: 'vowel+1',
    label: 'shift vowels forward by 1',
    family: 'vowel',
    kind: 'conditional',
    apply: (s) => shiftWhere(s, 1, (c) => VOWELS.has(c)),
  },
  {
    id: 'even+1',
    label: 'shift letters at positions 1, 3, 5, … forward by 1',
    family: 'even',
    kind: 'conditional',
    apply: (s) => shiftWhere(s, 1, (_, i) => i % 2 === 0),
  },
];

const OP_BY_ID = new Map(ANALOGY_OPS.map((o) => [o.id, o]));

export function applyOps(ids: readonly string[], s: string): string | null {
  let cur: string | null = s;
  for (const id of ids) {
    const op = OP_BY_ID.get(id);
    if (!op || cur === null) return null;
    cur = op.apply(cur);
  }
  return cur;
}

export interface AnalogySolution {
  /** Length of the shortest composition consistent with every example. */
  length: number;
  /** Distinct query outputs of all minimal consistent compositions (`null` = undefined on the query). */
  outputs: (string | null)[];
}

/**
 * Breadth-first search over compositions of up to `maxOps` primitives. States are
 * tuples (example strings, query string), so compositions that act identically on
 * every shown string are merged. Only `drop` shortens a string, which bounds pruning.
 */
export function solveAnalogy(content: AnalogyContent, maxOps = 4): AnalogySolution | null {
  const targets = content.examples.map((e) => e.to);
  const nEx = targets.length;
  type State = (string | null)[];
  const keyOf = (st: State) => st.map((x) => x ?? '#').join('|');
  let frontier: State[] = [[...content.examples.map((e) => e.from), content.query]];
  const seen = new Set(frontier.map(keyOf));
  for (let depth = 1; depth <= maxOps; depth++) {
    const remaining = maxOps - depth;
    const last = depth === maxOps;
    const next: State[] = [];
    const outputs = new Set<string | null>();
    for (const st of frontier) {
      for (const op of ANALOGY_OPS) {
        const ns: State = [];
        let ok = true;
        let goal = true;
        for (let i = 0; i < nEx; i++) {
          const t = op.apply(st[i] as string);
          if (t === null || t.length - targets[i].length > remaining) {
            ok = false;
            break;
          }
          if (t !== targets[i]) {
            goal = false;
            if (last) {
              ok = false;
              break;
            }
          }
          ns.push(t);
        }
        if (!ok) continue;
        const q = st[nEx];
        ns.push(q === null ? null : op.apply(q));
        if (goal) {
          outputs.add(ns[nEx]);
          continue;
        }
        if (last) continue;
        const k = keyOf(ns);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(ns);
      }
    }
    if (outputs.size > 0) return { length: depth, outputs: [...outputs] };
    frontier = next;
  }
  return null;
}

interface LevelDef {
  level: number;
  ops: number;
  examples: number;
  pool: OpKind[];
  needConditional: boolean;
}

const LEVEL_DEFS: LevelDef[] = [
  { level: 1, ops: 1, examples: 1, pool: ['basic'], needConditional: false },
  { level: 2, ops: 1, examples: 1, pool: ['hard', 'conditional'], needConditional: false },
  { level: 3, ops: 2, examples: 2, pool: ['basic', 'hard'], needConditional: false },
  { level: 4, ops: 2, examples: 1, pool: ['basic', 'hard'], needConditional: false },
  { level: 5, ops: 3, examples: 2, pool: ['basic', 'hard', 'conditional'], needConditional: false },
  { level: 6, ops: 3, examples: 2, pool: ['basic', 'hard', 'conditional'], needConditional: true },
  { level: 7, ops: 3, examples: 1, pool: ['basic', 'hard', 'conditional'], needConditional: false },
  { level: 8, ops: 4, examples: 2, pool: ['basic', 'hard', 'conditional'], needConditional: true },
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

function pickOps(def: LevelDef, rng: Rng): AnalogyOp[] {
  const pool = ANALOGY_OPS.filter((o) => def.pool.includes(o.kind));
  const conditional = ANALOGY_OPS.filter((o) => o.kind === 'conditional');
  const ops: AnalogyOp[] = [];
  const condAt = def.needConditional ? rng.int(0, def.ops - 1) : -1;
  for (let i = 0; i < def.ops; i++) {
    const source = i === condAt ? conditional : pool;
    const prev = ops[i - 1];
    const options = source.filter((o) => !prev || o.family !== prev.family);
    ops.push(rng.pick(options));
  }
  return ops;
}

function randomString(rng: Rng, mirrorCount: number): string {
  const maxLen = mirrorCount > 0 ? 6 : 7;
  const len = rng.int(mirrorCount > 0 ? 3 : 4, maxLen);
  const s = rng.sample(LETTERS, len);
  // Guarantee a vowel half of the time so vowel rules have material to act on.
  if (!s.some((c) => VOWELS.has(c)) && rng.chance(0.5)) {
    const v = rng.pick(['a', 'e', 'i', 'o', 'u']);
    s[rng.int(0, len - 1)] = v;
  }
  return s.join('');
}

export interface GeneratedAnalogy {
  content: AnalogyContent;
  key: string;
  ops: string[];
}

export function generateAnalogy(level: number, rng: Rng): GeneratedAnalogy {
  const def = LEVEL_DEFS.find((d) => d.level === level);
  if (!def) throw new Error(`analogy: unknown level ${level}`);
  for (let attempt = 0; attempt < 400; attempt++) {
    const ops = pickOps(def, rng);
    const ids = ops.map((o) => o.id);
    const mirrors = ids.filter((id) => id === 'mirror').length;
    if (mirrors > 1) continue;
    const strings = Array.from({ length: def.examples + 1 }, () => randomString(rng, mirrors));
    if (new Set(strings).size < strings.length) continue;
    const outs = strings.map((s) => applyOps(ids, s));
    if (outs.some((o) => o === null || o.length > 16)) continue;
    const query = strings[def.examples];
    const key = outs[def.examples] as string;
    if (key === query) continue;
    const examples = strings.slice(0, def.examples).map((from, i) => ({ from, to: outs[i] as string }));
    if (examples.some((e) => e.from === e.to)) continue;
    const content: AnalogyContent = { examples, query };
    const sol = solveAnalogy(content, def.ops);
    if (!sol || sol.length !== def.ops) continue;
    if (sol.outputs.length !== 1 || sol.outputs[0] !== key) continue;
    return { content, key, ops: ids };
  }
  throw new Error(`analogy: could not generate level ${level}`);
}

export const ANALOGY_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.4, c: 0, timeLimitMs: 60_000 },
  { level: 2, a: 1.55, b: -0.6, c: 0, timeLimitMs: 75_000 },
  { level: 3, a: 1.6, b: 0.2, c: 0, timeLimitMs: 90_000 },
  { level: 4, a: 1.65, b: 0.9, c: 0, timeLimitMs: 105_000 },
  { level: 5, a: 1.7, b: 1.6, c: 0, timeLimitMs: 120_000 },
  { level: 6, a: 1.75, b: 2.3, c: 0, timeLimitMs: 135_000 },
  { level: 7, a: 1.8, b: 2.9, c: 0, timeLimitMs: 135_000 },
  { level: 8, a: 1.9, b: 3.5, c: 0, timeLimitMs: 150_000 },
];

export const analogy = generatorParadigm<AnalogyContent, string>({
  id: 'analogy',
  version: 1,
  domain: 'reasoning',
  group: 'core',
  facet: 'analogical',
  title: 'Transformation analogies',
  subtitle: 'Find the transformation. Apply it to the new string.',
  construct: 'Analogical and inductive reasoning: inferring a composed transformation from examples.',
  instructions: [
    'Each example turns one string of letters into another.',
    'Work out the transformation and apply the same one to the last string.',
    'Transformations can reorder, shift, add or remove letters, and can be combined.',
    'Type the resulting letters and press Enter.',
  ],
  minutes: 6,
  minRtMs: 3000,
  levels: ANALOGY_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const { content, key, ops } = generateAnalogy(level, rng);
    const labels = ops.map((id) => OP_BY_ID.get(id)?.label ?? id);
    return {
      content,
      key,
      response: { kind: 'text', maxLength: 16, charset: 'letters' },
      features: {
        ops: ops.join('>'),
        opCount: ops.length,
        examples: content.examples.length,
        conditional: ops.some((id) => OP_BY_ID.get(id)?.kind === 'conditional'),
      },
      explanation: `Transformation: ${labels.join(', then ')}. ${content.query} → ${key}.`,
    };
  },
});
