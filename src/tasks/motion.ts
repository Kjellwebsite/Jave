import { h, sleep, waitFor } from '../core/dom';
import { clamp } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose, flash, interlude } from '../core/ui';

const TRIALS = 36;
const PRACTICE = 3;
const DOTS = 140;
const DURATION = 800;
const SPEED = 0.32; // aperture widths per second
const KEYS = [['f', 'arrowleft', '1'], ['j', 'arrowright', '2']];

type Dir = -1 | 1;

/** Random-dot kinematogram: a fraction of dots (the coherence) drifts one way, the rest wander. */
function playRdk(canvas: HTMLCanvasElement, coherence: number, dir: Dir, signal: AbortSignal): Promise<void> {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 280;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const color = getComputedStyle(canvas).color;
  const R = size / 2;
  const dotR = Math.max(1.6, size / 150);
  const randomPoint = (): [number, number] => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (R - dotR * 2);
    return [R + r * Math.cos(a), R + r * Math.sin(a)];
  };
  const dots = Array.from({ length: DOTS }, randomPoint);

  return waitFor<void>(signal, (resolve) => {
    let start = 0;
    let last = 0;
    let raf = 0;
    const step = (t: number) => {
      if (!start) start = last = t;
      const dt = Math.min(50, t - last) / 1000;
      last = t;
      const dist = SPEED * size * dt;
      for (const d of dots) {
        if (Math.random() < coherence) {
          d[0] += dir * dist;
        } else {
          const a = Math.random() * Math.PI * 2;
          d[0] += Math.cos(a) * dist;
          d[1] += Math.sin(a) * dist;
        }
        if ((d[0] - R) ** 2 + (d[1] - R) ** 2 > (R - dotR * 2) ** 2) {
          // Re-enter on the opposite edge so the density stays even.
          const p = randomPoint();
          d[0] = dir > 0 ? R - Math.abs(p[0] - R) : R + Math.abs(p[0] - R);
          d[1] = p[1];
        }
      }
      g.clearRect(0, 0, size, size);
      g.fillStyle = color;
      for (const [x, y] of dots) {
        g.beginPath();
        g.arc(x, y, dotR, 0, Math.PI * 2);
        g.fill();
      }
      if (t - start >= DURATION) {
        g.clearRect(0, 0, size, size);
        resolve();
      } else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
}

export const motion: TaskDef = {
  id: 'motion',
  domain: 'perception',
  name: 'Motion Sense',
  tagline: 'Find the drift in the noise.',
  minutes: 3,
  measures: ['Motion Perception', 'Visual Discrimination', 'Visual Attention'],
  instructions: [
    'A cloud of dots moves for less than a second. Some drift left or right together, the rest move randomly.',
    'Say which way the drifting dots went.',
    'The fewer dots drift together, the harder it gets. The task adapts to find your limit.',
    'Keys: F / ← for left, J / → for right. Or tap the buttons.',
  ],
  async run(ctx) {
    const canvas = h('canvas', { class: 'md-canvas', 'aria-label': 'Moving dots' });
    const fb = h('div', { class: 'md-feedback' });
    const trials: { coherence: number; dir: Dir; correct: boolean; practice: boolean }[] = [];
    let c = 0.5;
    let streak = 0;
    let lastMove: 'up' | 'down' | null = null;
    const reversals: number[] = [];

    const runTrial = async (practice: boolean, n: number) => {
      ctx.progress(practice ? 0 : n, TRIALS);
      const coherence = practice ? 0.9 : c;
      const dir: Dir = Math.random() < 0.5 ? -1 : 1;
      const label = h('p', { class: 'prompt' }, practice ? `Practice ${n + 1} of ${PRACTICE}` : `Trial ${n + 1} of ${TRIALS}`);
      const wrap = h('div', { class: 'md' }, label, h('div', { class: 'md-aperture' }, canvas, h('span', { class: 'md-fix' })), fb);
      ctx.stage.replaceChildren(wrap);
      await sleep(450, ctx.signal);
      await playRdk(canvas, coherence, dir, ctx.signal);
      const res = await choose(wrap, { options: ['← Left', 'Right →'], layout: 'row', keys: KEYS }, ctx.signal);
      const correct = (res.index === 0 ? -1 : 1) === dir;
      trials.push({ coherence, dir, correct, practice });
      if (practice) {
        await flash(fb, correct, correct ? 'Correct' : 'Wrong', 700, ctx.signal);
        return;
      }
      // Two-down one-up staircase on coherence.
      let move: 'up' | 'down' | null = null;
      if (correct) {
        streak++;
        if (streak === 2) {
          streak = 0;
          move = 'down';
        }
      } else {
        streak = 0;
        move = 'up';
      }
      if (move) {
        if (lastMove && move !== lastMove) reversals.push(c);
        lastMove = move;
        c = clamp(move === 'down' ? c * 0.75 : c / 0.75, 0.02, 1);
      }
      await sleep(200, ctx.signal);
    };

    for (let i = 0; i < PRACTICE; i++) await runTrial(true, i);
    await interlude(ctx.stage, 'Ready', `${TRIALS} trials, no feedback. It will get very hard. Guess when you are unsure.`, ctx.signal, 'Start');
    for (let i = 0; i < TRIALS; i++) await runTrial(false, i);
    ctx.progress(TRIALS, TRIALS);

    const real = trials.filter((t) => !t.practice);
    const tail = reversals.length >= 4 ? reversals.slice(-6) : real.slice(-10).map((t) => t.coherence);
    const threshold = Math.pow(10, tail.reduce((s, v) => s + Math.log10(v), 0) / tail.length);
    const easy = real.filter((t) => t.coherence >= 0.3);
    return {
      score: threshold,
      scoreDisplay: `${Math.round(threshold * 100)}% coherence threshold`,
      facets: [
        { facet: 'Motion Perception', display: `${(threshold * 100).toFixed(1)}%`, note: 'Share of dots that must drift together for you to see it, lower is better' },
        { facet: 'Visual Discrimination', display: easy.length ? `${easy.filter((t) => t.correct).length}/${easy.length}` : 'n/a', note: 'Correct on clear trials (30%+ drifting)' },
        { facet: 'Visual Attention', display: `${real.filter((t) => t.correct).length}/${real.length}`, note: 'All trials correct' },
      ],
      trials,
    };
  },
};
