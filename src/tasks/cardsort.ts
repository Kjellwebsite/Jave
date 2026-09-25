import { h, s, sleep } from '../core/dom';
import { shuffle } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose, flash } from '../core/ui';

type Dim = 'color' | 'shape' | 'number';
interface Card {
  color: number;
  shape: number;
  number: number; // 0..3 → 1..4 symbols
}

/** Okabe-Ito colours stay distinguishable with the common forms of colour blindness. */
const COLORS = ['#E69F00', '#0072B2', '#009E73', '#CC79A7'];
const COLOR_NAMES = ['orange', 'blue', 'green', 'pink'];
const SHAPE_NAMES = ['triangle', 'star', 'cross', 'circle'];
const RULES: Dim[] = ['color', 'shape', 'number', 'color', 'shape', 'number'];
const RUN_TO_SWITCH = 6;
const MAX_TRIALS = 48;

const KEYS: Card[] = [0, 1, 2, 3].map((i) => ({ color: i, shape: i, number: i }));

/** Only cards that match each key card on at most one dimension, so every choice reveals one rule. */
const DECK: Card[] = [];
for (let color = 0; color < 4; color++)
  for (let shape = 0; shape < 4; shape++)
    for (let number = 0; number < 4; number++)
      if (color !== shape && shape !== number && color !== number) DECK.push({ color, shape, number });

const POS: [number, number][][] = [
  [[50, 65]],
  [[50, 40], [50, 90]],
  [[50, 30], [50, 65], [50, 100]],
  [[30, 42], [70, 42], [30, 88], [70, 88]],
];

function symbol(shape: number, x: number, y: number, fill: string): SVGElement {
  const r = 13;
  switch (shape) {
    case 0:
      return s('polygon', { points: `${x},${y - r} ${x + r},${y + r * 0.85} ${x - r},${y + r * 0.85}`, fill });
    case 1: {
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r * 1.05;
        pts.push(`${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`);
      }
      return s('polygon', { points: pts.join(' '), fill });
    }
    case 2: {
      const w = r * 0.42;
      return s('path', {
        d: `M${x - w},${y - r}h${2 * w}v${r - w}h${r - w}v${2 * w}h${-(r - w)}v${r - w}h${-2 * w}v${-(r - w)}h${-(r - w)}v${-2 * w}h${r - w}z`,
        fill,
      });
    }
    default:
      return s('circle', { cx: x, cy: y, r: r * 0.95, fill });
  }
}

function drawCard(card: Card): SVGElement {
  const n = card.number;
  const label = `${n + 1} ${COLOR_NAMES[card.color]} ${SHAPE_NAMES[card.shape]}${n ? 's' : ''}`;
  return s(
    'svg',
    { viewBox: '0 0 100 130', class: 'ws-card', role: 'img', 'aria-label': label },
    ...POS[n].map(([x, y]) => symbol(card.shape, x, y, COLORS[card.color])),
  );
}

const matchIndex = (card: Card, dim: Dim) => card[dim];

export const cardsort: TaskDef = {
  id: 'cardsort',
  domain: 'executive',
  name: 'Rule Shift',
  tagline: 'Crack the hidden rule. Then crack it again.',
  minutes: 3,
  measures: ['Cognitive Flexibility', 'Rule Switching', 'Set Shifting', 'Error Monitoring'],
  instructions: [
    'Match each new card to one of the four cards at the top.',
    'Cards can match by colour, by shape or by number. Only one of these is the current rule.',
    'Nobody tells you the rule. After each match you see if you were right.',
    'The rule changes without warning from time to time. Notice it and adapt.',
  ],
  async run(ctx) {
    const deck = [...shuffle(DECK), ...shuffle(DECK)];
    const trials: { card: Card; rule: Dim; chosen: number | null; correct: boolean; perseverative: boolean; rt: number }[] = [];
    let ruleIdx = 0;
    let run = 0;
    let categories = 0;
    let previousRule: Dim | null = null;
    let firstCategoryAt = 0;

    for (let t = 0; t < MAX_TRIALS && ruleIdx < RULES.length; t++) {
      ctx.progress(t, MAX_TRIALS);
      const rule = RULES[ruleIdx];
      const card = deck[t];
      const target = h('div', { class: 'ws-target' }, drawCard(card));
      ctx.stage.replaceChildren(h('p', { class: 'prompt' }, 'Where does this card belong?'));
      const keysHost = h('div', { class: 'ws-keys' });
      const fb = h('div', { class: 'ws-feedback' });
      ctx.stage.append(keysHost, target, fb);
      const res = await choose(keysHost, { options: KEYS.map(drawCard), layout: 'row', className: 'ws-options' }, ctx.signal);
      const correct = res.index === matchIndex(card, rule);
      const perseverative =
        !correct && previousRule !== null && res.index === matchIndex(card, previousRule) && run === 0;
      trials.push({ card, rule, chosen: res.index, correct, perseverative, rt: res.rt });

      if (correct) {
        run++;
        if (run === RUN_TO_SWITCH) {
          categories++;
          if (categories === 1) firstCategoryAt = t + 1;
          previousRule = rule;
          ruleIdx++;
          run = 0;
        }
      } else {
        run = 0;
      }
      await flash(fb, correct, correct ? 'Correct' : 'Wrong', 650, ctx.signal);
      await sleep(120, ctx.signal);
    }
    ctx.progress(MAX_TRIALS, MAX_TRIALS);

    const correctCount = trials.filter((t) => t.correct).length;
    const perseverative = trials.filter((t) => t.perseverative).length;
    const afterError = trials.slice(1).filter((_, i) => !trials[i].correct);
    const postErrorAcc = afterError.length ? afterError.filter((t) => t.correct).length / afterError.length : 1;
    // Finishing all six rules early means the remaining trials would have been correct.
    const score = (correctCount + (MAX_TRIALS - trials.length)) / MAX_TRIALS;

    return {
      score,
      scoreDisplay: `${categories} of ${RULES.length} rules cracked`,
      facets: [
        { facet: 'Rule Switching', display: `${categories}/${RULES.length} rules`, note: `First rule found after ${firstCategoryAt || '—'} cards` },
        { facet: 'Set Shifting', display: `${perseverative} perseverative`, note: 'Errors from sticking to the old rule, lower is better' },
        { facet: 'Error Monitoring', display: `${Math.round(postErrorAcc * 100)}%`, note: 'Correct right after a mistake' },
        { facet: 'Cognitive Flexibility', display: `${Math.round(score * 100)}%`, note: 'Overall accuracy' },
      ],
      trials,
    };
  },
};
