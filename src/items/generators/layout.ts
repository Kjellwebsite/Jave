/**
 * Layout precision. A card or form layout built on a column grid with an 8-px
 * baseline and constant gutters. Exactly one element breaks the system by δ px
 * (left edge off its column, spacing off the rhythm, or width off the columns).
 * δ is never a multiple of 8, so the broken element is the only one off the grid.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export type ElementKind = 'heading' | 'text' | 'button' | 'image' | 'input';

export interface LayoutElement {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ElementKind;
}

export interface LayoutContent {
  width: number;
  height: number;
  elements: LayoutElement[];
}

export type BreakType = 'align' | 'spacing' | 'width';

const WIDTH = 360;
const HEIGHT = 480;
export const GRID = 8;

export interface GridSystem {
  margin: number;
  gutter: number;
  columns: number;
  colWidth: number;
}

/** Every margin/gutter/column combination whose column width lands on the 8-px grid. */
export const SYSTEMS: GridSystem[] = [16, 24, 32].flatMap((margin) =>
  [8, 16, 24].flatMap((gutter) =>
    [2, 3, 4].flatMap((columns) => {
      const colWidth = (WIDTH - 2 * margin - (columns - 1) * gutter) / columns;
      return Number.isInteger(colWidth) && colWidth % GRID === 0 && colWidth >= 56 ? [{ margin, gutter, columns, colWidth }] : [];
    }),
  ),
);

export const columnX = (s: GridSystem, col: number) => s.margin + col * (s.colWidth + s.gutter);
export const spanWidth = (s: GridSystem, span: number) => span * s.colWidth + (span - 1) * s.gutter;

export function overlaps(a: LayoutElement, b: LayoutElement): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface Slot {
  kind: ElementKind;
  col: number;
  span: number;
  h: number;
}

/** k positive parts summing to n. */
function composition(n: number, k: number, rng: Rng): number[] {
  const cuts = rng.sample(
    Array.from({ length: n - 1 }, (_, i) => i + 1),
    k - 1,
  ).sort((a, b) => a - b);
  return [...cuts, n].map((c, i) => c - (i === 0 ? 0 : cuts[i - 1]));
}

/** Lay a row of slots over consecutive column spans, optionally leaving leading columns empty. */
function spans(n: number, k: number, rng: Rng, leadEmpty = false): { col: number; span: number }[] {
  const lead = leadEmpty && n - k >= 1 ? rng.int(1, n - k) : 0;
  let col = lead;
  return composition(n - lead, k, rng).map((span) => {
    const out = { col, span };
    col += span;
    return out;
  });
}

type RowKind = 'heading' | 'text' | 'media' | 'buttons' | 'inputs' | 'image';

function makeRow(kind: RowKind, n: number, rng: Rng): Slot[] {
  switch (kind) {
    case 'heading':
      return [{ kind: 'heading', col: 0, span: n >= 3 && rng.chance(0.3) ? n - 1 : n, h: rng.pick([24, 32]) }];
    case 'text':
      return [{ kind: 'text', col: 0, span: n >= 3 && rng.chance(0.4) ? n - 1 : n, h: 16 }];
    case 'image':
      return [{ kind: 'image', col: 0, span: n, h: rng.pick([64, 96]) }];
    case 'media': {
      const [a, b] = spans(n, 2, rng);
      const imageFirst = rng.chance(0.5);
      const img = { kind: 'image' as const, h: rng.pick([48, 64]) };
      const txt = { kind: 'text' as const, h: 16 };
      return [
        { ...(imageFirst ? img : txt), ...a },
        { ...(imageFirst ? txt : img), ...b },
      ];
    }
    case 'buttons':
      return spans(n, 2, rng, n >= 3 && rng.chance(0.5)).map((s) => ({ kind: 'button', h: rng.pick([32, 40]), ...s }));
    case 'inputs':
      return spans(n, rng.chance(0.5) ? 1 : 2, rng).map((s) => ({ kind: 'input', h: 40, ...s }));
  }
}

const SINGLE: RowKind[] = ['heading', 'text', 'text', 'image', 'inputs'];
const DOUBLE: RowKind[] = ['media', 'buttons', 'buttons', 'inputs'];

export interface LayoutItem {
  content: LayoutContent;
  key: number;
  system: GridSystem;
  rowGap: number;
  breakType: BreakType;
  delta: number;
}

interface LevelConfig {
  level: number;
  delta: number;
  elements: number;
}

const CONFIGS: LevelConfig[] = [
  { level: 1, delta: 12, elements: 6 },
  { level: 2, delta: 10, elements: 7 },
  { level: 3, delta: 6, elements: 8 },
  { level: 4, delta: 4, elements: 9 },
  { level: 5, delta: 3, elements: 10 },
  { level: 6, delta: 2, elements: 12 },
];

export function generateLayout(level: number, rng: Rng): LayoutItem {
  const cfg = CONFIGS.find((c) => c.level === level);
  if (!cfg) throw new Error(`layout: unknown level ${level}`);
  // Drawn once so that rejections cannot skew where the broken element sits.
  const key = rng.int(0, cfg.elements - 1);
  const breakType = rng.pick<BreakType>(['align', 'spacing', 'width']);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const system = rng.pick(SYSTEMS);
    const rowGap = rng.pick([8, 16, 24]);
    const n = system.columns;

    // Rows of slots, starting with a heading.
    const rows: Slot[][] = [makeRow('heading', n, rng)];
    let count = 1;
    while (count < cfg.elements) {
      const left = cfg.elements - count;
      const kind = left >= 2 && rng.chance(cfg.elements >= 9 ? 0.7 : 0.45) ? rng.pick(DOUBLE) : rng.pick(SINGLE);
      const row = makeRow(kind, n, rng);
      if (row.length > left) continue;
      rows.push(row);
      count += row.length;
    }

    const elements: LayoutElement[] = [];
    let y = system.margin;
    for (const row of rows) {
      for (const s of row) elements.push({ x: columnX(system, s.col), y, w: spanWidth(system, s.span), h: s.h, kind: s.kind });
      y += Math.max(...row.map((s) => s.h)) + rowGap;
    }
    if (y - rowGap > HEIGHT - system.margin) continue;

    const sign = rng.chance(0.5) ? 1 : -1;
    const d = sign * cfg.delta;
    const el = { ...elements[key] };
    if (breakType === 'align') el.x += d;
    else if (breakType === 'spacing') el.y += d;
    else el.w += d;
    elements[key] = el;

    if (el.x < 0 || el.y < 0 || el.x + el.w > WIDTH || el.y + el.h > HEIGHT || el.w < GRID) continue;
    if (elements.some((o, i) => i !== key && overlaps(o, el))) continue;

    return {
      content: { width: WIDTH, height: HEIGHT, elements },
      key,
      system,
      rowGap,
      breakType,
      delta: cfg.delta,
    };
  }
  throw new Error(`layout: could not generate level ${level}`);
}

export const LAYOUT_LEVELS: LevelSpec[] = CONFIGS.map((c, i) => ({
  level: c.level,
  a: [1.4, 1.5, 1.5, 1.6, 1.7, 1.8][i],
  b: [-1.2, -0.5, 0.2, 0.9, 1.7, 2.5][i],
  c: 1 / c.elements,
  timeLimitMs: [30_000, 35_000, 40_000, 45_000, 50_000, 60_000][i],
}));

const BREAK_TEXT: Record<BreakType, string> = {
  align: 'left edge is off its column',
  spacing: 'spacing breaks the vertical rhythm',
  width: 'width does not end on a column',
};

export const layout = generatorParadigm<LayoutContent, number>({
  id: 'layout',
  version: 1,
  domain: 'attention',
  group: 'applied',
  facet: 'layout-precision',
  title: 'Layout precision',
  subtitle: 'One element is off. Find it.',
  construct: 'Visual precision for interface layouts: detecting small breaks in alignment and spacing systems.',
  instructions: [
    'Each layout is built on a grid of columns with even spacing.',
    'Exactly one element is misaligned, spaced unevenly, or has the wrong width.',
    'Select that element. The offset gets smaller as you go.',
  ],
  minutes: 3,
  minRtMs: 1500,
  levels: LAYOUT_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const item = generateLayout(level, rng);
    const n = item.content.elements.length;
    return {
      content: item.content,
      key: item.key,
      response: { kind: 'choice', options: n },
      features: { delta: item.delta, elements: n, breakType: item.breakType, columns: item.system.columns },
      explanation: `Element ${item.key + 1} (${item.content.elements[item.key].kind}): its ${BREAK_TEXT[item.breakType]} by ${item.delta} px.`,
    };
  },
});
