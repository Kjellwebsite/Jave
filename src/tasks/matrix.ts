import { h, s, sleep } from '../core/dom';
import { pick, sample, shuffle } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose } from '../core/ui';

type Attr = 'shape' | 'count' | 'fill' | 'size';
type Cell = Record<Attr, number>;
type Rule = 'const' | 'row' | 'prog' | 'dist';

const ATTRS: Attr[] = ['shape', 'count', 'fill', 'size'];
const DOMAIN_SIZE: Record<Attr, number> = { shape: 5, count: 3, fill: 3, size: 3 };
const RULES_FOR: Record<Attr, Rule[]> = {
  shape: ['row', 'dist'],
  fill: ['row', 'dist'],
  count: ['prog', 'dist', 'row'],
  size: ['prog', 'dist', 'row'],
};

/** How many attributes vary per item. Difficulty rises through the set. */
const LEVELS = [1, 1, 2, 2, 3, 3, 4, 4];
const WEIGHTS = [1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5];
const TIME_LIMIT = 60_000;

interface Puzzle {
  grid: Cell[]; // 9 cells, last one is the answer
  options: Cell[];
  answer: number;
  rules: Partial<Record<Attr, Rule>>;
}

const key = (c: Cell) => ATTRS.map((a) => c[a]).join('.');

function cellsFor(rule: Rule, size: number): (r: number, c: number) => number {
  switch (rule) {
    case 'const': {
      const v = Math.floor(Math.random() * size);
      return () => v;
    }
    case 'row': {
      const vals = sample([...Array(size).keys()], 3);
      return (r) => vals[r];
    }
    case 'prog': {
      const up = Math.random() < 0.5;
      return (_r, c) => (up ? c : 2 - c);
    }
    case 'dist': {
      const vals = sample([...Array(size).keys()], 3);
      const dir = Math.random() < 0.5 ? 1 : 2;
      return (r, c) => vals[(c + dir * r) % 3];
    }
  }
}

function makePuzzle(level: number): Puzzle {
  const varying = sample(ATTRS, level);
  const rules: Partial<Record<Attr, Rule>> = {};
  const fns = {} as Record<Attr, (r: number, c: number) => number>;
  for (const a of ATTRS) {
    const rule: Rule = varying.includes(a) ? pick(RULES_FOR[a]) : 'const';
    rules[a] = rule;
    fns[a] = cellsFor(rule, DOMAIN_SIZE[a]);
  }
  const grid: Cell[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) grid.push({ shape: fns.shape(r, c), count: fns.count(r, c), fill: fns.fill(r, c), size: fns.size(r, c) });

  const answer = grid[8];
  const seen = new Set([key(answer)]);
  const distractors: Cell[] = [];
  // Change one attribute at a time, preferring the attributes that carry a rule.
  const order = [...shuffle(varying), ...shuffle(ATTRS.filter((a) => !varying.includes(a)))];
  const candidates: Cell[] = [];
  for (const a of order) {
    for (const v of shuffle([...Array(DOMAIN_SIZE[a]).keys()])) {
      if (v !== answer[a]) candidates.push({ ...answer, [a]: v });
    }
  }
  // Double changes as a fallback when single changes run out.
  for (let i = 0; i < 20; i++) {
    const [a, b] = sample(ATTRS, 2);
    candidates.push({
      ...answer,
      [a]: (answer[a] + 1 + Math.floor(Math.random() * (DOMAIN_SIZE[a] - 1))) % DOMAIN_SIZE[a],
      [b]: (answer[b] + 1 + Math.floor(Math.random() * (DOMAIN_SIZE[b] - 1))) % DOMAIN_SIZE[b],
    });
  }
  // Take a spread over attributes: first pass one per attribute, then fill up.
  const perAttr = new Map<Attr, Cell[]>();
  for (const c of candidates) {
    const changed = ATTRS.filter((a) => c[a] !== answer[a]);
    if (changed.length !== 1) continue;
    const list = perAttr.get(changed[0]) ?? [];
    list.push(c);
    perAttr.set(changed[0], list);
  }
  for (const a of order) {
    const c = perAttr.get(a)?.[0];
    if (c && !seen.has(key(c)) && distractors.length < 5) {
      seen.add(key(c));
      distractors.push(c);
    }
  }
  for (const c of candidates) {
    if (distractors.length >= 5) break;
    if (!seen.has(key(c))) {
      seen.add(key(c));
      distractors.push(c);
    }
  }
  const options = shuffle([answer, ...distractors]);
  return { grid, options, answer: options.indexOf(answer), rules };
}

// ---------- drawing ----------

const POSITIONS: [number, number][][] = [
  [[50, 50]],
  [[31, 50], [69, 50]],
  [[50, 29], [29, 69], [71, 69]],
];
const RADII = [9, 12.5, 16];

function shapePath(shape: number, x: number, y: number, r: number): SVGElement {
  switch (shape) {
    case 0:
      return s('circle', { cx: x, cy: y, r });
    case 1:
      return s('rect', { x: x - r * 0.88, y: y - r * 0.88, width: r * 1.76, height: r * 1.76 });
    case 2: {
      const pts = [0, 1, 2].map((i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        return `${x + r * 1.1 * Math.cos(a)},${y + r * 1.1 * Math.sin(a) + r * 0.15}`;
      });
      return s('polygon', { points: pts.join(' ') });
    }
    case 3:
      return s('polygon', { points: `${x},${y - r * 1.15} ${x + r * 1.15},${y} ${x},${y + r * 1.15} ${x - r * 1.15},${y}` });
    default: {
      const pts = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i * Math.PI) / 3;
        return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
      });
      return s('polygon', { points: pts.join(' ') });
    }
  }
}

function drawCell(cell: Cell): SVGElement {
  const fillClass = ['f-none', 'f-half', 'f-full'][cell.fill];
  const shapes = POSITIONS[cell.count].map(([x, y]) => shapePath(cell.shape, x, y, RADII[cell.size]));
  return s('svg', { viewBox: '0 0 100 100', class: `mx-cell ${fillClass}`, 'aria-hidden': 'true' }, ...shapes);
}

function drawGrid(p: Puzzle): HTMLElement {
  const cells = p.grid.slice(0, 8).map((c) => h('div', { class: 'mx-slot' }, drawCell(c)));
  cells.push(h('div', { class: 'mx-slot mx-missing' }, h('span', null, '?')));
  return h('div', { class: 'mx-grid', role: 'img', 'aria-label': '3 by 3 pattern with the last cell missing' }, cells);
}

export const matrix: TaskDef = {
  id: 'matrix',
  domain: 'reasoning',
  name: 'Matrix Reasoning',
  tagline: 'Find the rule. Complete the pattern.',
  minutes: 5,
  measures: ['Fluid Reasoning', 'Abstract Reasoning', 'Pattern Detection', 'Inductive Reasoning'],
  instructions: [
    'Each puzzle is a 3 × 3 grid with the last cell missing.',
    'Shapes change across rows by hidden rules: shape, number, shading or size.',
    'Pick the option that completes the grid. You have 60 seconds per puzzle.',
    'Puzzles get harder as you go. Speed is not scored, accuracy is.',
  ],
  async run(ctx) {
    const trials: { level: number; correct: boolean; rt: number; timedOut: boolean; rules: Puzzle['rules'] }[] = [];
    for (let i = 0; i < LEVELS.length; i++) {
      ctx.progress(i, LEVELS.length);
      const p = makePuzzle(LEVELS[i]);
      const q = h('div', { class: 'mx' }, drawGrid(p));
      ctx.stage.replaceChildren(h('p', { class: 'prompt' }, 'Which option completes the pattern?'), q);
      const res = await choose(
        ctx.stage,
        { options: p.options.map(drawCell), layout: 'grid3', className: 'mx-options', timeLimit: TIME_LIMIT },
        ctx.signal,
      );
      trials.push({ level: LEVELS[i], correct: res.index === p.answer, rt: res.rt, timedOut: res.index === null, rules: p.rules });
      await sleep(250, ctx.signal);
    }
    ctx.progress(LEVELS.length, LEVELS.length);

    const total = WEIGHTS.reduce((a, b) => a + b, 0);
    const earned = trials.reduce((sum, t, i) => sum + (t.correct ? WEIGHTS[i] : 0), 0);
    const easy = trials.filter((t) => t.level <= 2);
    const hard = trials.filter((t) => t.level >= 3);
    const solved = trials.filter((t) => t.correct).length;
    const avgSolve = trials.filter((t) => t.correct).reduce((a, t) => a + t.rt, 0) / Math.max(1, solved);
    return {
      score: earned / total,
      scoreDisplay: `${solved} of ${trials.length} solved`,
      facets: [
        { facet: 'Fluid Reasoning', display: `${Math.round((earned / total) * 100)}% weighted` },
        { facet: 'Pattern Detection', display: `${easy.filter((t) => t.correct).length}/${easy.length}`, note: 'One or two rules' },
        { facet: 'Abstract Reasoning', display: `${hard.filter((t) => t.correct).length}/${hard.length}`, note: 'Three or four rules at once' },
        { facet: 'Inductive Reasoning', display: solved ? `${(avgSolve / 1000).toFixed(1)} s` : 'n/a', note: 'Average time per solved puzzle' },
      ],
      trials,
    };
  },
};
