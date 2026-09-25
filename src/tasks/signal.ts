import { h, painted, sleep } from '../core/dom';
import { clamp, mean } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose, continueButton, interlude } from '../core/ui';

const TRIALS = 30;
const PRACTICE = 3;
const BASE = 45;
const FLASH_MS = 450;
const CONFIDENCE = [
  { label: 'Guessing', value: 0.5 },
  { label: 'Unsure', value: 0.65 },
  { label: 'Fairly sure', value: 0.82 },
  { label: 'Certain', value: 0.97 },
];
const SIDE_KEYS = [['f', 'arrowleft', '1'], ['j', 'arrowright', '2']];

function drawDots(canvas: HTMLCanvasElement, count: number) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 160;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, size, size);
  g.fillStyle = getComputedStyle(canvas).color;
  const r = size / 55;
  const pts: [number, number][] = [];
  let guard = 0;
  while (pts.length < count && guard++ < 20000) {
    const x = r * 2 + Math.random() * (size - r * 4);
    const y = r * 2 + Math.random() * (size - r * 4);
    if (pts.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > (r * 2.6) ** 2)) pts.push([x, y]);
  }
  for (const [x, y] of pts) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** Type-2 AUROC: chance that a random correct trial got more confidence than a random error. */
function auroc(conf: number[], correct: boolean[]): number {
  const hits = conf.filter((_, i) => correct[i]);
  const misses = conf.filter((_, i) => !correct[i]);
  if (!hits.length || !misses.length) return 0.5;
  let sum = 0;
  for (const a of hits) for (const b of misses) sum += a > b ? 1 : a === b ? 0.5 : 0;
  return sum / (hits.length * misses.length);
}

export const signal: TaskDef = {
  id: 'signal',
  domain: 'metacognition',
  name: 'Signal Check',
  tagline: 'Do you know when you know?',
  minutes: 3,
  measures: ['Metacognitive Accuracy', 'Confidence Calibration', 'Self-Monitoring', 'Uncertainty Recognition'],
  instructions: [
    'Two boxes of dots flash briefly. Pick the box that had more dots.',
    'Then rate how sure you are.',
    'The task adjusts so it stays hard for everyone. You will be unsure often, and that is the point.',
    'Your score is not how many you get right. It is how well your confidence tracks your accuracy.',
  ],
  async run(ctx) {
    const left = h('canvas', { class: 'sg-box', 'aria-label': 'Left box' });
    const right = h('canvas', { class: 'sg-box', 'aria-label': 'Right box' });
    const fix = h('div', { class: 'sg-fix' }, '+');
    const boxes = h('div', { class: 'sg-boxes' }, left, fix, right);
    const trials: { diff: number; moreLeft: boolean; correct: boolean; confidence: number; practice: boolean }[] = [];
    let diff = 14;
    let streak = 0;

    const runTrial = async (practice: boolean, n: number) => {
      ctx.progress(practice ? 0 : n, TRIALS);
      const moreLeft = Math.random() < 0.5;
      const d = Math.round(diff);
      const panel = h('div', { class: 'sg' }, h('p', { class: 'prompt' }, practice ? `Practice ${n + 1} of ${PRACTICE}` : `Trial ${n + 1} of ${TRIALS}`), boxes);
      ctx.stage.replaceChildren(panel);
      boxes.classList.remove('is-shown');
      await sleep(500, ctx.signal);
      drawDots(left, moreLeft ? BASE + d : BASE);
      drawDots(right, moreLeft ? BASE : BASE + d);
      boxes.classList.add('is-shown');
      await painted();
      await sleep(FLASH_MS, ctx.signal);
      drawDots(left, 0);
      drawDots(right, 0);
      boxes.classList.remove('is-shown');
      const pickRes = await choose(panel, { options: ['Left had more', 'Right had more'], layout: 'row', keys: SIDE_KEYS }, ctx.signal);
      const correct = (pickRes.index === 0) === moreLeft;
      let confidence = 0;
      if (!practice) {
        panel.querySelector('.opts')?.remove();
        panel.append(h('p', { class: 'prompt prompt-sub' }, 'How sure are you?'));
        const c = await choose(panel, { options: CONFIDENCE.map((x) => x.label), layout: 'row', className: 'sg-conf' }, ctx.signal);
        confidence = CONFIDENCE[c.index ?? 0].value;
      } else {
        panel.append(h('div', { class: `flash ${correct ? 'is-ok' : 'is-bad'}` }, correct ? 'Correct' : 'Wrong'));
        await sleep(700, ctx.signal);
      }
      // Two-down one-up staircase keeps accuracy near 71%.
      if (correct) {
        streak++;
        if (streak === 2) {
          diff = clamp(diff * 0.8, 1, 40);
          streak = 0;
        }
      } else {
        streak = 0;
        diff = clamp(diff / 0.8, 1, 40);
      }
      trials.push({ diff: d, moreLeft, correct, confidence, practice });
    };

    for (let i = 0; i < PRACTICE; i++) await runTrial(true, i);

    // Prediction before the real run.
    const slider = h('input', { id: 'sg-predict', type: 'range', min: '0', max: String(TRIALS), value: '20', class: 'range' });
    const out = h('output', { class: 'range-value', for: 'sg-predict' }, `20 of ${TRIALS}`);
    slider.addEventListener('input', () => (out.textContent = `${slider.value} of ${TRIALS}`));
    const box = h(
      'div',
      { class: 'interlude' },
      h('h3', null, 'Before you start'),
      h('p', null, `How many of the ${TRIALS} trials do you think you'll get right?`),
      h('label', { class: 'range-wrap', for: 'sg-predict' }, slider, out),
    );
    ctx.stage.replaceChildren(box);
    await continueButton(box, 'Lock in', ctx.signal);
    const predicted = Number(slider.value);
    await interlude(ctx.stage, 'Ready', 'From now on you rate your confidence after each answer. There is no feedback.', ctx.signal, 'Start');

    for (let i = 0; i < TRIALS; i++) await runTrial(false, i);
    ctx.progress(TRIALS, TRIALS);

    const real = trials.filter((t) => !t.practice);
    const conf = real.map((t) => t.confidence);
    const correct = real.map((t) => t.correct);
    const accuracy = correct.filter(Boolean).length / real.length;
    const meanConf = mean(conf);
    const score = auroc(conf, correct);
    const bias = Math.round((meanConf - accuracy) * 100);
    const errors = real.filter((t) => !t.correct);
    const flagged = errors.filter((t) => t.confidence <= 0.65).length;
    const actual = correct.filter(Boolean).length;

    return {
      score,
      scoreDisplay: `Sensitivity ${score.toFixed(2)}`,
      facets: [
        { facet: 'Metacognitive Accuracy', display: score.toFixed(2), note: '0.50 = confidence says nothing, 1.00 = perfect insight' },
        {
          facet: 'Confidence Calibration',
          display: Math.abs(bias) <= 3 ? 'Well calibrated' : bias > 0 ? `Overconfident by ${bias} pts` : `Underconfident by ${-bias} pts`,
          note: `Average confidence ${Math.round(meanConf * 100)}% vs ${Math.round(accuracy * 100)}% correct`,
        },
        { facet: 'Self-Monitoring', display: `Predicted ${predicted}, got ${actual}`, note: `Off by ${Math.abs(predicted - actual)}` },
        { facet: 'Uncertainty Recognition', display: errors.length ? `${flagged}/${errors.length}` : 'No errors', note: 'Errors you marked as guessing or unsure' },
      ],
      trials: [...trials, { predicted }],
    };
  },
};
