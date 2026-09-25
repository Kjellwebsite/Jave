import { h, sleep, waitFor } from '../core/dom';
import { randInt } from '../core/rng';
import type { TaskDef } from '../core/types';
import { countIn, flash } from '../core/ui';

/** Irregular block layout, in percent of the board (top-left corner of each block). */
const LAYOUT: [number, number][] = [
  [10, 62], [24, 16], [36, 44], [30, 82], [56, 66], [60, 26], [80, 8], [84, 48], [70, 84],
];
const ON_MS = 650;
const GAP_MS = 250;
const START_LENGTH = 3;
const MAX_LENGTH = 9;

function makeSequence(length: number): number[] {
  const seq: number[] = [];
  while (seq.length < length) {
    const b = randInt(0, LAYOUT.length - 1);
    if (!seq.includes(b)) seq.push(b);
  }
  return seq;
}

export const corsi: TaskDef = {
  id: 'corsi',
  domain: 'memory',
  name: 'Corsi Blocks',
  tagline: 'Watch the path. Repeat it.',
  minutes: 3,
  measures: ['Spatial Working Memory', 'Working Memory'],
  instructions: [
    'Blocks light up one after another.',
    'When they stop, tap the blocks in the same order.',
    'Sequences start at 3 blocks and grow by one each time you succeed.',
    'You get two tries per length. The test ends when both tries at a length fail.',
  ],
  async run(ctx) {
    const blocks = LAYOUT.map(([x, y], i) =>
      h('button', {
        class: 'corsi-block',
        type: 'button',
        'aria-label': `Block ${i + 1}`,
        style: { left: `${x}%`, top: `${y}%` },
        disabled: true,
      }),
    );
    const status = h('div', { class: 'corsi-status', 'aria-live': 'polite' }, 'Watch');
    const board = h('div', { class: 'corsi-board' }, blocks);
    ctx.stage.replaceChildren(h('div', { class: 'corsi' }, status, board));
    await countIn(board, ctx.signal);

    const trials: { length: number; sequence: number[]; response: number[]; correct: boolean }[] = [];
    let span = 0;
    let bothAtSpan = false;
    let length = START_LENGTH;

    while (length <= MAX_LENGTH) {
      let correctAtLength = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        ctx.progress(length - START_LENGTH, MAX_LENGTH - START_LENGTH + 1);
        const seq = makeSequence(length);
        status.textContent = `Watch · ${length} blocks`;
        board.classList.remove('is-input');
        blocks.forEach((b) => (b.disabled = true));
        await sleep(600, ctx.signal);
        for (const i of seq) {
          blocks[i].classList.add('is-lit');
          await sleep(ON_MS, ctx.signal);
          blocks[i].classList.remove('is-lit');
          await sleep(GAP_MS, ctx.signal);
        }

        status.textContent = 'Your turn';
        board.classList.add('is-input');
        blocks.forEach((b) => (b.disabled = false));
        const response: number[] = [];
        await waitFor<void>(ctx.signal, (resolve) => {
          const handlers = blocks.map((b, i) => {
            const f = (e: PointerEvent) => {
              e.preventDefault();
              response.push(i);
              b.classList.add('is-tapped');
              setTimeout(() => b.classList.remove('is-tapped'), 180);
              status.textContent = `Your turn · ${response.length}/${length}`;
              if (response.length === length) resolve();
            };
            b.addEventListener('pointerdown', f);
            return f;
          });
          return () => blocks.forEach((b, i) => b.removeEventListener('pointerdown', handlers[i]));
        });
        blocks.forEach((b) => (b.disabled = true));
        const correct = response.every((v, i) => v === seq[i]);
        trials.push({ length, sequence: seq, response, correct });
        if (correct) correctAtLength++;
        await flash(board, correct, correct ? 'Correct' : 'Not quite', 700, ctx.signal);
      }
      if (correctAtLength === 0) break;
      span = length;
      bothAtSpan = correctAtLength === 2;
      length++;
    }
    ctx.progress(1, 1);

    const totalCorrect = trials.filter((t) => t.correct).length;
    const score = span + (bothAtSpan ? 0.5 : 0);
    return {
      score,
      scoreDisplay: span ? `Span of ${span} blocks` : 'Span below 3',
      facets: [
        { facet: 'Spatial Working Memory', display: `${span || '< 3'} blocks`, note: 'Longest sequence repeated correctly' },
        { facet: 'Working Memory', display: `${totalCorrect} of ${trials.length}`, note: 'Sequences repeated correctly' },
        { facet: 'Corsi total score', display: String(span * totalCorrect), note: 'Span × correct sequences' },
      ],
      trials,
    };
  },
};
