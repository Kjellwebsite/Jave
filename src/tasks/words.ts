import { countCorrect, runQuiz, type QuizItem } from '../core/quiz';
import type { TaskDef } from '../core/types';

/** Correct option first; options are shuffled on screen. Ordered by difficulty. */
const VOCAB: [string, string[]][] = [
  ['rapid', ['quick', 'slow', 'heavy', 'bright']],
  ['candid', ['frank', 'sweet', 'hidden', 'careful']],
  ['meticulous', ['thorough', 'careless', 'hasty', 'generous']],
  ['ephemeral', ['fleeting', 'eternal', 'ethereal', 'fragile']],
  ['obstinate', ['stubborn', 'obvious', 'fragile', 'ashamed']],
  ['laconic', ['terse', 'lazy', 'verbose', 'lyrical']],
  ['ubiquitous', ['omnipresent', 'unique', 'rare', 'ambiguous']],
  ['obsequious', ['servile', 'obscure', 'arrogant', 'obvious']],
  ['perfunctory', ['cursory', 'thorough', 'fragrant', 'precise']],
  ['pusillanimous', ['cowardly', 'generous', 'petty', 'tiny']],
  ['recondite', ['obscure', 'reconciled', 'recent', 'cheerful']],
  ['tergiversate', ['equivocate', 'repeat', 'reverse', 'digress']],
];

const ANALOGIES: [string, string[]][] = [
  ['Bird is to nest as bee is to …', ['hive', 'honey', 'flower', 'sting']],
  ['Thermometer is to temperature as odometer is to …', ['distance', 'speed', 'fuel', 'time']],
  ['Author is to novel as composer is to …', ['symphony', 'orchestra', 'piano', 'conductor']],
  ['Sculptor is to chisel as surgeon is to …', ['scalpel', 'hospital', 'patient', 'nurse']],
  ['Prologue is to epilogue as overture is to …', ['finale', 'symphony', 'opera', 'intermission']],
  ['Cacophony is to sound as eyesore is to …', ['sight', 'sound', 'taste', 'smell']],
];

const ITEMS: QuizItem[] = [
  ...VOCAB.map(([word, options]): QuizItem => ({
    tag: 'Vocabulary',
    question: `Which word is closest in meaning to “${word}”?`,
    options,
    answer: 0,
  })),
  ...ANALOGIES.map(([question, options]): QuizItem => ({ tag: 'Verbal Analogies', question, options, answer: 0 })),
];

export const words: TaskDef = {
  id: 'words',
  domain: 'language',
  name: 'Word Power',
  tagline: 'Meaning, precision, relation.',
  minutes: 4,
  measures: ['Vocabulary', 'Verbal Analogies', 'Verbal Reasoning'],
  instructions: [
    'Part 1: pick the word closest in meaning. Words get rarer as you go.',
    'Part 2: complete the analogy.',
    'You have 20 seconds per question. If you do not know, make your best guess.',
  ],
  async run(ctx) {
    const trials = await runQuiz(ctx, ITEMS, { timeLimit: 20_000 });
    const correct = countCorrect(trials);
    const vocab = countCorrect(trials, 'Vocabulary');
    const analog = countCorrect(trials, 'Verbal Analogies');
    return {
      score: correct / ITEMS.length,
      scoreDisplay: `${correct} of ${ITEMS.length} correct`,
      facets: [
        { facet: 'Vocabulary', display: `${vocab}/${VOCAB.length}` },
        { facet: 'Verbal Analogies', display: `${analog}/${ANALOGIES.length}` },
        { facet: 'Verbal Reasoning', display: `${Math.round((correct / ITEMS.length) * 100)}%`, note: 'Both parts combined' },
      ],
      trials,
    };
  },
};
