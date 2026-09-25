import { h, painted, sleep, waitFor } from '../core/dom';
import { median, randInt, sd } from '../core/rng';
import type { TaskDef } from '../core/types';
import { interlude } from '../core/ui';

const SIMPLE_TRIALS = 15;
const CHOICE_TRIALS = 20;
/** Responses faster than this are anticipations, not reactions. */
const MIN_RT = 150;
const MAX_RT = 1500;
const ERROR_PENALTY_MS = 15;

type Side = 'left' | 'right';

interface Trial {
  kind: 'simple' | 'choice';
  side?: Side;
  rt: number | null;
  response?: Side;
  correct: boolean;
  early: boolean;
}

/**
 * Waits for a response, reporting the event timestamp so rendering delays in
 * our own code do not add to the measured time.
 */
function waitResponse(
  pad: HTMLElement,
  ctxSignal: AbortSignal,
  mode: 'simple' | 'choice',
  timeoutMs: number,
): Promise<{ t: number; side?: Side } | null> {
  return waitFor(ctxSignal, (resolve) => {
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      if (mode === 'simple') return resolve({ t: e.timeStamp });
      const rect = pad.getBoundingClientRect();
      resolve({ t: e.timeStamp, side: e.clientX < rect.left + rect.width / 2 ? 'left' : 'right' });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (mode === 'simple' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        return resolve({ t: e.timeStamp });
      }
      if (mode === 'choice') {
        const k = e.key.toLowerCase();
        if (k === 'f' || k === 'arrowleft') resolve({ t: e.timeStamp, side: 'left' });
        else if (k === 'j' || k === 'arrowright') resolve({ t: e.timeStamp, side: 'right' });
      }
    };
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    pad.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      pad.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  });
}

export const reaction: TaskDef = {
  id: 'reaction',
  domain: 'speed',
  name: 'Reaction Suite',
  tagline: 'Fast hands, clean decisions.',
  minutes: 3,
  measures: ['Simple Reaction Time', 'Choice Reaction Time', 'Response Consistency', 'Processing Speed'],
  instructions: [
    'Part 1: when the dot appears, respond as fast as you can. Press Space or tap the panel.',
    'Part 2: a dot appears on the left or right. Respond on the same side: F / ← for left, J / → for right, or tap that half.',
    'Responding before the dot appears counts as a false start.',
    'Use the same device and posture for the whole test. Touch screens are compared with other touch users.',
  ],
  async run(ctx) {
    const trials: Trial[] = [];
    const total = SIMPLE_TRIALS + CHOICE_TRIALS;

    const runPart = async (kind: 'simple' | 'choice', count: number, offset: number) => {
      const dot = h('div', { class: 'rt-dot' });
      const hint = h('div', { class: 'rt-hint' });
      const pad = h('div', { class: `rt-pad rt-${kind}`, role: 'button', tabindex: '0', 'aria-label': 'Response panel' }, dot, hint);
      if (kind === 'choice') pad.append(h('div', { class: 'rt-divider' }));
      ctx.stage.replaceChildren(pad);
      let done = 0;
      let earlies = 0;
      while (done < count) {
        ctx.progress(offset + done, total);
        dot.className = 'rt-dot';
        hint.textContent = 'Wait for it';
        pad.classList.remove('is-early');
        const side: Side = Math.random() < 0.5 ? 'left' : 'right';
        const foreperiod = randInt(800, 2400);

        // A response during the foreperiod is a false start.
        const early = await waitResponse(pad, ctx.signal, kind, foreperiod);
        if (early) {
          earlies++;
          trials.push({ kind, rt: null, correct: false, early: true });
          pad.classList.add('is-early');
          hint.textContent = 'Too early';
          await sleep(900, ctx.signal);
          // Cap repeats so someone cannot loop forever.
          if (earlies > 6) done++;
          continue;
        }

        dot.classList.add('is-on');
        if (kind === 'choice') dot.classList.add(`at-${side}`);
        hint.textContent = '';
        const onset = await painted();
        const res = await waitResponse(pad, ctx.signal, kind, MAX_RT);
        const rt = res ? res.t - onset : null;
        const correct = !!res && (kind === 'simple' || res.side === side) && rt !== null && rt >= MIN_RT;
        trials.push({ kind, side: kind === 'choice' ? side : undefined, rt, response: res?.side, correct, early: false });
        dot.className = 'rt-dot';
        hint.textContent = rt === null ? 'Too slow' : kind === 'choice' && res?.side !== side ? 'Wrong side' : `${Math.round(rt)} ms`;
        hint.classList.toggle('is-bad', !correct);
        await sleep(650, ctx.signal);
        hint.classList.remove('is-bad');
        done++;
      }
    };

    await interlude(ctx.stage, 'Part 1 · Simple reaction', `${SIMPLE_TRIALS} trials. Respond the moment the dot appears.`, ctx.signal, 'Start');
    await runPart('simple', SIMPLE_TRIALS, 0);
    await interlude(
      ctx.stage,
      'Part 2 · Choice reaction',
      ctx.input === 'touch'
        ? `${CHOICE_TRIALS} trials. Tap the half of the panel where the dot appears.`
        : `${CHOICE_TRIALS} trials. Press F or ← for left, J or → for right.`,
      ctx.signal,
      'Start',
    );
    await runPart('choice', CHOICE_TRIALS, SIMPLE_TRIALS);
    ctx.progress(total, total);

    const valid = (k: Trial['kind']) =>
      trials.filter((t) => t.kind === k && t.correct && t.rt !== null && t.rt <= MAX_RT).map((t) => t.rt!);
    const simple = valid('simple');
    const choice = valid('choice');
    const choiceTrials = trials.filter((t) => t.kind === 'choice' && !t.early);
    const errors = choiceTrials.filter((t) => !t.correct).length;
    const falseStarts = trials.filter((t) => t.early).length;
    const simpleMed = median(simple) || MAX_RT;
    const choiceMed = median(choice) || MAX_RT;
    const score = (simpleMed + choiceMed) / 2 + ERROR_PENALTY_MS * errors;

    return {
      score,
      scoreDisplay: `${Math.round(score)} ms speed index`,
      facets: [
        { facet: 'Simple Reaction Time', display: `${Math.round(simpleMed)} ms`, note: 'Median' },
        { facet: 'Choice Reaction Time', display: `${Math.round(choiceMed)} ms`, note: `Median · ${choiceTrials.length - errors}/${choiceTrials.length} correct` },
        { facet: 'Response Consistency', display: `± ${Math.round(sd(simple))} ms`, note: 'Spread of simple reaction times, lower is steadier' },
        { facet: 'Processing Speed', display: `${Math.round(choiceMed - simpleMed)} ms`, note: 'Extra time a two-way decision costs you' },
        { facet: 'False starts', display: String(falseStarts) },
      ],
      trials,
    };
  },
};
