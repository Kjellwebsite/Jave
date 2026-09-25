import { h, sleep } from '../core/dom';
import { pick, randInt, shuffle } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose, interlude } from '../core/ui';

type Format = 'pct' | 'ratio' | 'frac';
interface Outcome {
  p: number;
  v: number;
}
interface Deal {
  outcomes: Outcome[];
  format: Format;
}

const EV_ITEMS = 14;
const TIME_LIMIT = 12_000;
const KEYS = [['f', 'arrowleft', '1'], ['j', 'arrowright', '2']];

const ev = (d: Deal) => d.outcomes.reduce((s, o) => s + o.p * o.v, 0);
const round5 = (v: number) => Math.max(5, Math.round(v / 5) * 5);
const round10 = (v: number) => Math.max(10, Math.round(v / 10) * 10);

const FRACTIONS: Record<string, string> = {
  '0.25': '1/4', '0.5': '1/2', '0.75': '3/4', '0.2': '1/5', '0.4': '2/5', '0.6': '3/5', '0.8': '4/5',
  '0.333': '1/3', '0.667': '2/3', '0.1': '1/10', '0.9': '9/10',
};

function probLabel(p: number, format: Format): string {
  if (p >= 0.999) return 'Guaranteed';
  if (format === 'ratio') {
    const n = Math.round(1 / p);
    if (Math.abs(1 / n - p) < 0.001) return `1 in ${n} chance`;
  }
  if (format === 'frac') {
    const f = FRACTIONS[String(Math.round(p * 1000) / 1000)];
    if (f) return `${f} chance`;
  }
  return `${Math.round(p * 100)}% chance`;
}

const sure = (v: number): Deal => ({ outcomes: [{ p: 1, v }], format: 'pct' });
const gamble = (outcomes: Outcome[], format: Format = pick(['pct', 'pct', 'ratio', 'frac'])): Deal => ({ outcomes, format });

/** Returns two deals whose expected values differ by a noticeable but not obvious margin. */
function makeItem(close: boolean): [Deal, Deal] {
  for (;;) {
    const d = (close ? 0.09 + Math.random() * 0.06 : 0.18 + Math.random() * 0.17) * (Math.random() < 0.5 ? 1 : -1);
    const type = randInt(0, 4);
    let pair: [Deal, Deal];
    if (type === 0) {
      const p = pick([0.2, 0.25, 0.4, 0.5, 0.6, 0.75, 0.8, 0.9]);
      const x = randInt(3, 20) * 20;
      pair = [gamble([{ p, v: x }]), sure(round5(p * x * (1 + d)))];
    } else if (type === 1) {
      const p1 = pick([0.1, 0.2, 0.25, 0.5]);
      const p2 = pick([0.6, 0.75, 0.8, 0.9]);
      const x1 = randInt(10, 40) * 20;
      pair = [gamble([{ p: p1, v: x1 }]), gamble([{ p: p2, v: round10((p1 * x1 * (1 + d)) / p2) }])];
    } else if (type === 2) {
      const w = randInt(6, 15) * 20;
      const l = randInt(2, Math.floor(w / 20) - 1) * 20;
      const target = ((w - l) / 2) * (1 + d);
      if (target < 10) continue;
      pair = [gamble([{ p: 0.5, v: w }, { p: 0.5, v: -l }], 'pct'), sure(round5(target))];
    } else if (type === 3) {
      const n = pick([3, 4, 5, 8, 10]);
      const x = randInt(8, 40) * 25;
      const p2 = pick([0.5, 0.6, 0.75]);
      pair = [gamble([{ p: 1 / n, v: x }], 'ratio'), gamble([{ p: p2, v: round10(((x / n) * (1 + d)) / p2) }], 'pct')];
    } else {
      const big = randInt(8, 20) * 25;
      const mid = randInt(2, 6) * 10;
      const deal = gamble([{ p: 0.2, v: big }, { p: 0.5, v: mid }], 'pct');
      pair = [deal, sure(round5(ev(deal) * (1 + d)))];
    }
    const [a, b] = pair.map(ev);
    if (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) < 0.07) continue;
    return shuffle(pair) as [Deal, Deal];
  }
}

function drawDeal(deal: Deal, label: string): HTMLElement {
  const rest = 1 - deal.outcomes.reduce((s, o) => s + o.p, 0);
  const rows = deal.outcomes.map((o) =>
    h(
      'div',
      { class: 'od-row' },
      h('span', { class: 'od-p' }, probLabel(o.p, deal.format)),
      h('span', { class: `od-v ${o.v < 0 ? 'is-loss' : ''}` }, `${o.v < 0 ? '−' : '+'}${Math.abs(o.v)}`),
      h('span', { class: 'od-bar' }, h('span', { style: { width: `${o.p * 100}%` } })),
    ),
  );
  if (rest > 0.001) {
    rows.push(
      h('div', { class: 'od-row is-rest' }, h('span', { class: 'od-p' }, 'Otherwise'), h('span', { class: 'od-v' }, '0'), h('span', { class: 'od-bar' }, h('span', { style: { width: `${rest * 100}%` } }))),
    );
  }
  return h('div', { class: 'od-deal' }, h('div', { class: 'od-label' }, label), ...rows);
}

const STYLE_ITEMS: { kind: 'risk' | 'loss'; a: Deal; b: Deal; boldIndex: number }[] = [
  { kind: 'risk', a: sure(30), b: gamble([{ p: 0.5, v: 60 }], 'pct'), boldIndex: 1 },
  { kind: 'loss', a: gamble([{ p: 0.5, v: 60 }, { p: 0.5, v: -50 }], 'pct'), b: sure(0), boldIndex: 0 },
  { kind: 'risk', a: gamble([{ p: 0.25, v: 320 }], 'pct'), b: sure(80), boldIndex: 0 },
  { kind: 'loss', a: sure(0), b: gamble([{ p: 0.5, v: 100 }, { p: 0.5, v: -50 }], 'pct'), boldIndex: 1 },
  { kind: 'risk', a: sure(150), b: gamble([{ p: 0.75, v: 200 }], 'pct'), boldIndex: 1 },
  { kind: 'loss', a: gamble([{ p: 0.5, v: 150 }, { p: 0.5, v: -50 }], 'pct'), b: sure(0), boldIndex: 0 },
];

export const odds: TaskDef = {
  id: 'odds',
  domain: 'decision',
  name: 'Odds',
  tagline: 'Two deals. Twelve seconds. Pick the better bet.',
  minutes: 3,
  measures: ['Expected Value Reasoning', 'Decision Under Time Pressure', 'Risk Assessment', 'Risk Taking', 'Loss Aversion'],
  instructions: [
    'You see two deals. Each one pays points with some chance.',
    'Pick the deal that pays more points on average if you played it many times.',
    'You have 12 seconds per decision. Estimating is fine.',
    'At the end, six questions ask what you would personally prefer. Those have no right answer.',
  ],
  async run(ctx) {
    const trials: { kind: 'ev' | 'risk' | 'loss'; close?: boolean; correct?: boolean; bold?: boolean; rt: number; timedOut: boolean }[] = [];
    const closeFlags = shuffle(Array.from({ length: EV_ITEMS }, (_, i) => i < 5));
    const total = EV_ITEMS + STYLE_ITEMS.length;

    for (let i = 0; i < EV_ITEMS; i++) {
      ctx.progress(i, total);
      const [a, b] = makeItem(closeFlags[i]);
      const better = ev(a) > ev(b) ? 0 : 1;
      ctx.stage.replaceChildren(h('p', { class: 'prompt' }, 'Which deal pays more on average?'));
      const res = await choose(ctx.stage, { options: [drawDeal(a, 'Deal A'), drawDeal(b, 'Deal B')], layout: 'cards', keys: KEYS, timeLimit: TIME_LIMIT }, ctx.signal);
      trials.push({ kind: 'ev', close: closeFlags[i], correct: res.index === better, rt: res.rt, timedOut: res.index === null });
      await sleep(200, ctx.signal);
    }

    await interlude(ctx.stage, 'Your preferences', 'Six choices with no right or wrong answer. Pick the deal you would rather take if the points were real money.', ctx.signal);
    for (let i = 0; i < STYLE_ITEMS.length; i++) {
      ctx.progress(EV_ITEMS + i, total);
      const item = STYLE_ITEMS[i];
      ctx.stage.replaceChildren(h('p', { class: 'prompt' }, 'Which would you rather take?'));
      const res = await choose(ctx.stage, { options: [drawDeal(item.a, 'Option A'), drawDeal(item.b, 'Option B')], layout: 'cards', keys: KEYS }, ctx.signal);
      trials.push({ kind: item.kind, bold: res.index === item.boldIndex, rt: res.rt, timedOut: false });
      await sleep(200, ctx.signal);
    }
    ctx.progress(total, total);

    const evTrials = trials.filter((t) => t.kind === 'ev');
    const correct = evTrials.filter((t) => t.correct).length;
    const close = evTrials.filter((t) => t.close);
    const answered = evTrials.filter((t) => !t.timedOut);
    const avgRt = answered.reduce((s, t) => s + t.rt, 0) / Math.max(1, answered.length);
    const riskBold = trials.filter((t) => t.kind === 'risk' && t.bold).length;
    const lossAccept = trials.filter((t) => t.kind === 'loss' && t.bold).length;

    return {
      score: correct / EV_ITEMS,
      scoreDisplay: `${correct} of ${EV_ITEMS} best bets`,
      facets: [
        { facet: 'Expected Value Reasoning', display: `${correct}/${EV_ITEMS}`, note: 'Picked the deal that pays more on average' },
        { facet: 'Risk Assessment', display: `${close.filter((t) => t.correct).length}/${close.length}`, note: 'Close calls within 15%' },
        { facet: 'Decision Under Time Pressure', display: `${(avgRt / 1000).toFixed(1)} s`, note: `Average decision time · ${evTrials.length - answered.length} timed out` },
      ],
      styles: [
        { name: 'Risk Taking', left: 'Cautious', right: 'Bold', value: riskBold / 3 },
        { name: 'Loss Aversion', left: 'Loss-tolerant', right: 'Loss-averse', value: 1 - lossAccept / 3 },
      ],
      trials,
    };
  },
};
