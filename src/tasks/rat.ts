import { h, sleep } from '../core/dom';
import { sample } from '../core/rng';
import type { TaskDef } from '../core/types';
import { textAnswer } from '../core/ui';

/** Compound remote associates, ordered roughly from easier to harder. */
const ITEMS: { words: [string, string, string]; answer: string }[] = [
  { words: ['cottage', 'swiss', 'cake'], answer: 'cheese' },
  { words: ['cream', 'skate', 'water'], answer: 'ice' },
  { words: ['show', 'life', 'row'], answer: 'boat' },
  { words: ['night', 'wrist', 'stop'], answer: 'watch' },
  { words: ['flake', 'mobile', 'cone'], answer: 'snow' },
  { words: ['worm', 'shelf', 'end'], answer: 'book' },
  { words: ['dew', 'comb', 'bee'], answer: 'honey' },
  { words: ['river', 'note', 'account'], answer: 'bank' },
  { words: ['fish', 'mine', 'rush'], answer: 'gold' },
  { words: ['duck', 'fold', 'dollar'], answer: 'bill' },
  { words: ['salt', 'deep', 'foam'], answer: 'sea' },
  { words: ['manners', 'round', 'tennis'], answer: 'table' },
  { words: ['aid', 'rubber', 'wagon'], answer: 'band' },
  { words: ['political', 'surprise', 'line'], answer: 'party' },
  { words: ['board', 'magic', 'death'], answer: 'black' },
  { words: ['stick', 'maker', 'point'], answer: 'match' },
  { words: ['cane', 'daddy', 'plum'], answer: 'sugar' },
  { words: ['sore', 'shoulder', 'sweat'], answer: 'cold' },
  { words: ['age', 'mile', 'sand'], answer: 'stone' },
  { words: ['pie', 'luck', 'belly'], answer: 'pot' },
];
const COUNT = 12;
const TIME_LIMIT = 30_000;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function isCorrect(input: string, answer: string) {
  const v = normalize(input);
  return v === answer || v === `${answer}s` || v === `${answer}es`;
}

export const rat: TaskDef = {
  id: 'rat',
  domain: 'creativity',
  name: 'Remote Associates',
  tagline: 'Three words. One hidden link.',
  minutes: 5,
  measures: ['Remote Associations', 'Creative Problem Solving', 'Conceptual Combination'],
  instructions: [
    'You see three words. Find one word that links to all three.',
    'Example: cottage · swiss · cake → cheese (cottage cheese, swiss cheese, cheesecake).',
    'The link word can come before or after each word.',
    'Type your answer and press Enter. You have 30 seconds per puzzle, or skip it.',
  ],
  async run(ctx) {
    // A random subset keeps repeat visits fresh; original order keeps difficulty rising.
    const picked = sample(ITEMS.slice(1).map((_, i) => i + 1), COUNT).sort((a, b) => a - b).map((i) => ITEMS[i]);
    const trials: { words: string[]; answer: string; response: string; correct: boolean; rt: number }[] = [];

    for (let i = 0; i < picked.length; i++) {
      ctx.progress(i, picked.length);
      const item = picked[i];
      const triad = h('div', { class: 'rat-words' }, ...item.words.map((w) => h('span', null, w)));
      const reveal = h('div', { class: 'rat-reveal', 'aria-live': 'polite' });
      ctx.stage.replaceChildren(h('p', { class: 'prompt' }, 'What word links all three?'), triad, reveal);
      const res = await textAnswer(ctx.stage, { placeholder: 'Your link word', timeLimit: TIME_LIMIT, id: `rat-${i}` }, ctx.signal);
      const correct = !res.skipped && isCorrect(res.text, item.answer);
      trials.push({ words: item.words, answer: item.answer, response: res.text, correct, rt: res.rt });
      reveal.classList.add(correct ? 'is-ok' : 'is-bad');
      reveal.replaceChildren(h('span', null, correct ? 'Correct · ' : 'Answer · '), h('strong', null, item.answer));
      await sleep(correct ? 900 : 1500, ctx.signal);
    }
    ctx.progress(picked.length, picked.length);

    const solved = trials.filter((t) => t.correct);
    const avg = solved.reduce((s, t) => s + t.rt, 0) / Math.max(1, solved.length);
    const fast = solved.filter((t) => t.rt < 10_000).length;
    return {
      score: solved.length / picked.length,
      scoreDisplay: `${solved.length} of ${picked.length} links found`,
      facets: [
        { facet: 'Remote Associations', display: `${solved.length}/${picked.length}` },
        { facet: 'Creative Problem Solving', display: solved.length ? `${(avg / 1000).toFixed(1)} s` : 'n/a', note: 'Average time to a solution' },
        { facet: 'Conceptual Combination', display: `${fast}`, note: 'Links found in under 10 seconds' },
      ],
      trials,
    };
  },
};
