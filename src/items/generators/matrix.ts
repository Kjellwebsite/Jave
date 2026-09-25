/**
 * Matrix inference generator.
 *
 * Rules follow Carpenter, Just & Shell (1990): constant, constant-in-row,
 * progression, distribution of three, arithmetic and set operations on
 * positions. Difficulty is predicted from layout and rules (Embretson, 1998;
 * Primi, 2001). Answer sets are balanced over three binary attribute changes
 * so the key cannot be found from the options alone (Hu et al., 2021).
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export type ScalarAttr = 'shape' | 'size' | 'shade' | 'angle' | 'count';
export type RuleKind = 'const' | 'rowConst' | 'prog' | 'dist3' | 'arith' | 'setop';
export type Layout = 'single' | 'grid9' | 'grid4';

export interface Panel {
  shape: number;
  size: number;
  shade: number;
  angle: number;
  /** Occupied cells for grid layouts (bitmask); 1 for single. */
  mask: number;
}

export interface ComponentSpec {
  layout: Layout;
  /** Rules per attribute. `pos` is the position mask for grids without a count rule. */
  rules: Partial<Record<ScalarAttr | 'pos', RuleKind>>;
  /** Fill order used by count rules. */
  fillOrder?: number[];
}

export interface MatrixContent {
  components: ComponentSpec[];
  /** 9 cells, row-major; each cell has one panel per component. The last cell is the missing one. */
  cells: Panel[][];
  options: Panel[][];
}

export const SHAPES = ['triangle', 'square', 'pentagon', 'hexagon', 'circle'] as const;
export const ANGLES = [0, 15, 30, 45];
const CIRCLE = 4;
const DOMAIN: Record<ScalarAttr, number> = { shape: 5, size: 5, shade: 5, angle: 4, count: 9 };

const cellsIn = (layout: Layout) => (layout === 'grid9' ? 9 : layout === 'grid4' ? 4 : 1);
const popcount = (m: number) => {
  let c = 0;
  while (m) {
    c += m & 1;
    m >>= 1;
  }
  return c;
};

type Table = number[][]; // [row][col]

/* ------------------------------------------------------------------ */
/* Rule tables                                                          */
/* ------------------------------------------------------------------ */

function scalarTable(rule: RuleKind, domain: number, rng: Rng, allowed?: number[]): Table {
  const values = allowed ?? Array.from({ length: domain }, (_, i) => i);
  switch (rule) {
    case 'const': {
      const v = rng.pick(values);
      return [0, 1, 2].map(() => [v, v, v]);
    }
    case 'rowConst': {
      const vs = rng.sample(values, 3);
      return vs.map((v) => [v, v, v]);
    }
    case 'prog': {
      const steps = domain >= 7 ? [-2, -1, 1, 2] : [-1, 1];
      for (let tries = 0; tries < 50; tries++) {
        const d = rng.pick(steps);
        const rows: Table = [];
        for (let r = 0; r < 3; r++) {
          const starts = values.filter((s) => values.includes(s + d) && values.includes(s + 2 * d));
          if (!starts.length) break;
          const s = rng.pick(starts);
          rows.push([s, s + d, s + 2 * d]);
        }
        if (rows.length === 3) return rows;
      }
      throw new Error('prog: no valid table');
    }
    case 'dist3': {
      const vs = rng.sample(values, 3);
      const shift = rng.pick([1, 2]);
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) => vs[(c + shift * r) % 3]));
    }
    case 'arith': {
      // Magnitudes are value + 1 so that "zero" never appears.
      const add = rng.chance(0.5);
      const rows: Table = [];
      for (let r = 0; r < 3; r++) {
        const opts: number[][] = [];
        for (const a of values)
          for (const b of values) {
            const m = add ? a + 1 + (b + 1) : a + 1 - (b + 1);
            const v = m - 1;
            if (values.includes(v) && a !== b) opts.push([a, b, v]);
          }
        rows.push(rng.pick(opts));
      }
      return rows;
    }
    default:
      throw new Error(`scalar rule ${rule} not supported`);
  }
}

type SetOp = 'xor' | 'or' | 'and';
const applyOp = (op: SetOp, a: number, b: number) => (op === 'xor' ? a ^ b : op === 'or' ? a | b : a & b);

function maskTable(rule: RuleKind, cells: number, rng: Rng): Table {
  const full = (1 << cells) - 1;
  const randMask = (minBits: number) => {
    for (;;) {
      const m = rng.int(1, full);
      const bits = popcount(m);
      if (bits >= minBits && bits <= cells - 1) return m;
    }
  };
  switch (rule) {
    case 'const': {
      const m = randMask(2);
      return [0, 1, 2].map(() => [m, m, m]);
    }
    case 'dist3': {
      const ms = new Set<number>();
      while (ms.size < 3) ms.add(randMask(2));
      const vs = [...ms];
      const shift = rng.pick([1, 2]);
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) => vs[(c + shift * r) % 3]));
    }
    case 'setop': {
      const op = rng.pick<SetOp>(['xor', 'or', 'and']);
      const rows: Table = [];
      while (rows.length < 3) {
        const a = randMask(2);
        const b = randMask(2);
        const c = applyOp(op, a, b);
        if (a === b || c === 0 || c === a || c === b || popcount(c) >= cells) continue;
        rows.push([a, b, c]);
      }
      return rows;
    }
    default:
      throw new Error(`mask rule ${rule} not supported`);
  }
}

/* ------------------------------------------------------------------ */
/* Uniqueness check: every rule that fits must predict the same value   */
/* ------------------------------------------------------------------ */

type Fitter = (t: Table, domain: number) => number | null;

const full = (t: Table) => [t[0], t[1]];
const partial = (t: Table) => t[2];

const scalarFitters: Fitter[] = [
  // constant
  (t) => {
    const v = t[0][0];
    return [...t[0], ...t[1], t[2][0], t[2][1]].every((x) => x === v) ? v : null;
  },
  // constant in a row
  (t) => (full(t).every((r) => r[0] === r[1] && r[1] === r[2]) && t[2][0] === t[2][1] ? t[2][0] : null),
  // progression with a common step
  (t) => {
    const d = t[0][1] - t[0][0];
    const ok = full(t).every((r) => r[1] - r[0] === d && r[2] - r[1] === d) && partial(t)[1] - partial(t)[0] === d;
    return ok ? t[2][1] + d : null;
  },
  // distribution of three over the same set
  (t) => {
    const set = (r: number[]) => [...r].sort((a, b) => a - b).join(',');
    if (new Set(t[0]).size !== 3 || set(t[0]) !== set(t[1])) return null;
    const missing = t[0].filter((v) => v !== t[2][0] && v !== t[2][1]);
    return t[2][0] !== t[2][1] && missing.length === 1 ? missing[0] : null;
  },
  // arithmetic on magnitudes (value + 1)
  (t) => (full(t).every((r) => r[2] + 1 === r[0] + 1 + (r[1] + 1)) ? t[2][0] + t[2][1] + 1 : null),
  (t) => (full(t).every((r) => r[2] + 1 === r[0] + 1 - (r[1] + 1)) ? t[2][0] - t[2][1] - 1 : null),
];

const maskFitters: Fitter[] = [
  scalarFitters[0],
  scalarFitters[1],
  scalarFitters[3],
  ...(['xor', 'or', 'and'] as SetOp[]).map(
    (op): Fitter =>
      (t) =>
        full(t).every((r) => applyOp(op, r[0], r[1]) === r[2]) ? applyOp(op, t[2][0], t[2][1]) : null,
  ),
  (t) => (full(t).every((r) => (r[0] & ~r[1]) === r[2]) ? t[2][0] & ~t[2][1] : null),
  (t) => (full(t).every((r) => (r[1] & ~r[0]) === r[2]) ? t[2][1] & ~t[2][0] : null),
];

const transpose = (t: Table): Table => [0, 1, 2].map((c) => [0, 1, 2].map((r) => t[r][c]));

/** Predictions of every rule (row-wise and column-wise) that fits the visible cells. */
export function predictions(t: Table, kind: 'scalar' | 'mask', domain: number): Set<number> {
  const fitters = kind === 'scalar' ? scalarFitters : maskFitters;
  const out = new Set<number>();
  for (const table of [t, transpose(t)]) {
    for (const f of fitters) {
      const p = f(table, domain);
      if (p !== null) out.add(p);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Levels                                                               */
/* ------------------------------------------------------------------ */

interface LevelTemplate {
  components: { layout: Layout; rules: RuleKind[]; ruleAttrs?: (ScalarAttr | 'pos')[] }[];
}

/** Rule lists per component; attributes are assigned randomly unless fixed. */
const TEMPLATES: Record<number, LevelTemplate> = {
  1: { components: [{ layout: 'single', rules: ['prog'], ruleAttrs: ['size'] }] },
  2: { components: [{ layout: 'single', rules: ['prog', 'dist3'] }] },
  3: { components: [{ layout: 'single', rules: ['prog', 'dist3'], ruleAttrs: ['angle', 'shade'] }] },
  4: { components: [{ layout: 'single', rules: ['dist3', 'prog', 'dist3'] }] },
  5: { components: [{ layout: 'grid9', rules: ['prog', 'dist3'], ruleAttrs: ['count', 'shape'] }] },
  6: { components: [{ layout: 'single', rules: ['arith', 'dist3', 'prog'], ruleAttrs: ['size', 'shape', 'shade'] }] },
  7: { components: [{ layout: 'grid9', rules: ['setop', 'dist3', 'prog'], ruleAttrs: ['pos', 'shade', 'size'] }] },
  8: {
    components: [
      { layout: 'single', rules: ['prog', 'dist3'] },
      { layout: 'single', rules: ['dist3', 'prog'] },
    ],
  },
  9: {
    components: [
      { layout: 'single', rules: ['arith', 'dist3', 'prog'], ruleAttrs: ['size', 'shape', 'angle'] },
      { layout: 'single', rules: ['prog', 'dist3'], ruleAttrs: ['shade', 'shape'] },
    ],
  },
  10: {
    components: [
      { layout: 'single', rules: ['dist3', 'prog', 'arith'], ruleAttrs: ['shape', 'shade', 'size'] },
      { layout: 'grid4', rules: ['setop', 'dist3', 'prog'], ruleAttrs: ['pos', 'shade', 'size'] },
    ],
  },
  11: {
    components: [
      { layout: 'single', rules: ['arith', 'dist3', 'prog', 'prog'], ruleAttrs: ['size', 'shape', 'shade', 'angle'] },
      { layout: 'grid4', rules: ['setop', 'dist3', 'prog'], ruleAttrs: ['pos', 'shade', 'size'] },
    ],
  },
};

export const MATRIX_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.6, b: -1.6, c: 0.125, timeLimitMs: 60_000 },
  { level: 2, a: 1.6, b: -0.9, c: 0.125, timeLimitMs: 75_000 },
  { level: 3, a: 1.7, b: -0.4, c: 0.125, timeLimitMs: 75_000 },
  { level: 4, a: 1.7, b: 0.2, c: 0.125, timeLimitMs: 90_000 },
  { level: 5, a: 1.7, b: 0.7, c: 0.125, timeLimitMs: 90_000 },
  { level: 6, a: 1.8, b: 1.2, c: 0.125, timeLimitMs: 105_000 },
  { level: 7, a: 1.8, b: 1.7, c: 0.125, timeLimitMs: 120_000 },
  { level: 8, a: 1.8, b: 2.2, c: 0.125, timeLimitMs: 120_000 },
  { level: 9, a: 1.9, b: 2.7, c: 0.125, timeLimitMs: 150_000 },
  { level: 10, a: 1.9, b: 3.2, c: 0.125, timeLimitMs: 165_000 },
  { level: 11, a: 2.0, b: 3.7, c: 0.125, timeLimitMs: 180_000 },
];

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

interface BuiltComponent {
  spec: ComponentSpec;
  tables: Partial<Record<ScalarAttr | 'pos', Table>>;
}

function assignAttrs(layout: Layout, rules: RuleKind[], fixed: (ScalarAttr | 'pos')[] | undefined, rng: Rng) {
  if (fixed) return fixed;
  const pool: ScalarAttr[] = ['shape', 'size', 'shade', 'angle'];
  const out: ScalarAttr[] = [];
  for (const rule of rules) {
    const options = pool.filter((a) => !out.includes(a) && (rule === 'arith' ? a === 'size' : rule === 'prog' ? a !== 'shape' : true));
    out.push(rng.pick(options));
  }
  return layout === 'single' ? out : out;
}

function buildComponent(layout: Layout, rules: RuleKind[], fixed: (ScalarAttr | 'pos')[] | undefined, rng: Rng): BuiltComponent {
  const attrs = assignAttrs(layout, rules, fixed, rng);
  const ruleMap: ComponentSpec['rules'] = {};
  attrs.forEach((a, i) => (ruleMap[a] = rules[i]));
  const cells = cellsIn(layout);
  const tables: BuiltComponent['tables'] = {};
  // Circles hide rotation, so exclude them when angle varies.
  const angleVaries = ruleMap.angle && ruleMap.angle !== 'const';
  const shapeValues = angleVaries ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
  for (const attr of ['shape', 'size', 'shade', 'angle'] as ScalarAttr[]) {
    const rule = ruleMap[attr] ?? 'const';
    tables[attr] = scalarTable(rule, DOMAIN[attr], rng, attr === 'shape' ? shapeValues : undefined);
  }
  const spec: ComponentSpec = { layout, rules: ruleMap };
  if (layout !== 'single') {
    if (ruleMap.count) {
      const maxCount = cells;
      tables.count = scalarTable(ruleMap.count, maxCount, rng, Array.from({ length: maxCount }, (_, i) => i)); // index = count − 1
      spec.fillOrder = rng.shuffle(Array.from({ length: cells }, (_, i) => i));
    } else {
      tables.pos = maskTable(ruleMap.pos ?? 'const', cells, rng);
    }
  }
  return { spec, tables };
}

function panelAt(c: BuiltComponent, r: number, col: number): Panel {
  const t = c.tables;
  let mask = 1;
  if (c.spec.layout !== 'single') {
    if (t.count) {
      const count = t.count[r][col] + 1;
      mask = c.spec.fillOrder!.slice(0, count).reduce((m, i) => m | (1 << i), 0);
    } else mask = t.pos![r][col];
  }
  return { shape: t.shape![r][col], size: t.size![r][col], shade: t.shade![r][col], angle: t.angle![r][col], mask };
}

function uniquelyDetermined(c: BuiltComponent): boolean {
  for (const [attr, table] of Object.entries(c.tables) as [ScalarAttr | 'pos', Table][]) {
    const kind = attr === 'pos' ? 'mask' : 'scalar';
    const preds = predictions(table, kind, attr === 'pos' ? 0 : DOMAIN[attr as ScalarAttr]);
    if (preds.size !== 1 || !preds.has(table[2][2])) return false;
  }
  return true;
}

type Slot = { comp: number; attr: ScalarAttr | 'pos' };

function alternative(slot: Slot, panel: Panel, comp: BuiltComponent, rng: Rng): Panel | null {
  const p = { ...panel };
  const cells = cellsIn(comp.spec.layout);
  const graded = (v: number, n: number) => {
    const opts = Array.from({ length: n }, (_, i) => i).filter((x) => Math.abs(x - v) >= 2);
    return opts.length ? rng.pick(opts) : null;
  };
  switch (slot.attr) {
    case 'shape': {
      const angleMatters = comp.spec.rules.angle && comp.spec.rules.angle !== 'const';
      const opts = [0, 1, 2, 3, 4].filter((s) => s !== p.shape && !(angleMatters && s === CIRCLE));
      p.shape = rng.pick(opts);
      return p;
    }
    case 'size':
    case 'shade': {
      const v = graded(p[slot.attr], 5);
      if (v === null) return null;
      p[slot.attr] = v;
      return p;
    }
    case 'angle': {
      if (p.shape === CIRCLE) return null;
      const v = graded(p.angle, 4);
      if (v === null) return null;
      p.angle = v;
      return p;
    }
    case 'count': {
      const count = popcount(p.mask);
      const opts = [count - 2, count + 2, count - 3, count + 3].filter((x) => x >= 1 && x <= cells);
      if (!opts.length) return null;
      const n = rng.pick(opts);
      p.mask = comp.spec.fillOrder!.slice(0, n).reduce((m, i) => m | (1 << i), 0);
      return p;
    }
    case 'pos': {
      for (let tries = 0; tries < 30; tries++) {
        const flip = rng.chance(0.5) ? 1 << rng.int(0, cells - 1) : (1 << rng.int(0, cells - 1)) | (1 << rng.int(0, cells - 1));
        const m = p.mask ^ flip;
        if (m !== 0 && m !== p.mask) {
          p.mask = m;
          return p;
        }
      }
      return null;
    }
  }
}

const panelKey = (ps: Panel[]) => ps.map((p) => `${p.shape}.${p.size}.${p.shade}.${p.angle}.${p.mask}`).join('|');

export function generateMatrix(level: number, rng: Rng): { content: MatrixContent; key: number; slots: Slot[] } {
  const tpl = TEMPLATES[level];
  for (let attempt = 0; attempt < 200; attempt++) {
    const comps = tpl.components.map((c) => buildComponent(c.layout, c.rules, c.ruleAttrs, rng));
    if (!comps.every(uniquelyDetermined)) continue;
    const cells: Panel[][] = [];
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) cells.push(comps.map((c) => panelAt(c, r, col)));
    const answer = cells[8];

    // Choose three slots, rule-governed first.
    const ruled: Slot[] = [];
    const constant: Slot[] = [];
    comps.forEach((c, i) => {
      const attrs: (ScalarAttr | 'pos')[] = ['shape', 'size', 'shade', 'angle'];
      if (c.spec.layout !== 'single') attrs.push(c.spec.rules.count ? 'count' : 'pos');
      for (const a of attrs) {
        const rule = c.spec.rules[a];
        if (a === 'angle' && answer[i].shape === CIRCLE) continue;
        (rule && rule !== 'const' ? ruled : constant).push({ comp: i, attr: a });
      }
    });
    const slots = [...rng.shuffle(ruled), ...rng.shuffle(constant)].slice(0, 3);
    if (slots.length < 3) continue;

    const alts: Panel[] = [];
    let ok = true;
    for (const slot of slots) {
      const alt = alternative(slot, answer[slot.comp], comps[slot.comp], rng);
      if (!alt) {
        ok = false;
        break;
      }
      alts.push(alt);
    }
    if (!ok) continue;

    // 2 × 2 × 2 balanced answer set.
    const options: Panel[][] = [];
    for (let m = 0; m < 8; m++) {
      const panels = answer.map((p) => ({ ...p }));
      slots.forEach((slot, i) => {
        if (m & (1 << i)) {
          const alt = alts[i];
          const target = panels[slot.comp];
          if (slot.attr === 'count' || slot.attr === 'pos') target.mask = alt.mask;
          else target[slot.attr] = alt[slot.attr];
        }
      });
      options.push(panels);
    }
    if (new Set(options.map(panelKey)).size !== 8) continue;
    const order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    const shuffled = order.map((i) => options[i]);
    return {
      content: { components: comps.map((c) => c.spec), cells: cells.map((c, i) => (i === 8 ? [] : c)), options: shuffled },
      key: order.indexOf(0),
      slots,
    };
  }
  throw new Error(`matrix: could not generate level ${level}`);
}

const ATTR_NAME: Record<string, string> = { shape: 'shape', size: 'size', shade: 'shade', angle: 'rotation', count: 'number of figures', pos: 'positions' };
const RULE_TEXT: Record<RuleKind, string> = {
  const: 'stays the same',
  rowConst: 'is constant within each row',
  prog: 'changes step by step along each row',
  dist3: 'takes the same three values in every row, in a different order',
  arith: 'in the third column equals the first combined with the second (added or subtracted)',
  setop: 'in the third column combine the first two (overlay, overlap or difference)',
};

/** Plain-language rule summary, shown in practice feedback and item review. */
function describe(content: MatrixContent): string {
  return content.components
    .map((c, i) => {
      const rules = Object.entries(c.rules)
        .filter(([, r]) => r !== 'const')
        .map(([a, r]) => `the ${ATTR_NAME[a]} ${RULE_TEXT[r as RuleKind]}`)
        .join('; ');
      const prefix = content.components.length > 1 ? (i === 0 ? 'Left part: ' : 'Right part: ') : '';
      return `${prefix}${rules || 'nothing varies'}.`;
    })
    .join(' ');
}

export const matrix = generatorParadigm<MatrixContent, number>({
  id: 'matrix',
  version: 1,
  domain: 'reasoning',
  group: 'core',
  facet: 'fluid-induction',
  title: 'Matrix inference',
  subtitle: 'Find the rules. Complete the matrix.',
  construct: 'Fluid inductive reasoning: discovering several rules at once and applying them together.',
  instructions: [
    'Each row follows the same rules. Rules can govern shape, size, shade, rotation, number or position.',
    'Work out every rule, then choose the option that completes the bottom-right cell.',
    'Later matrices have two independent parts, each with its own rules.',
    'Take the time you need. Accuracy matters, speed does not.',
  ],
  minutes: 6,
  minRtMs: 3000,
  levels: MATRIX_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const { content, key, slots } = generateMatrix(level, rng);
    const nRules = content.components.reduce((n, c) => n + Object.values(c.rules).filter((r) => r !== 'const').length, 0);
    const kinds = content.components.flatMap((c) => Object.values(c.rules).filter((r) => r !== 'const'));
    return {
      content,
      key,
      response: { kind: 'choice', options: 8 },
      features: {
        layout: content.components.map((c) => c.layout).join('+'),
        components: content.components.length,
        rules: nRules,
        arithmetic: kinds.includes('arith'),
        setop: kinds.includes('setop'),
        slots: slots.map((s) => `${s.comp}:${s.attr}`).join(','),
      },
      explanation: describe(content),
    };
  },
});
