/**
 * Compound remote associates (Mednick, 1962; Bowden & Jung-Beeman, 2003).
 * Convergent creative problem solving with an objective key. Reported in the
 * creativity section, never in the core composite.
 */
import { bandFor, provisional } from '../../adaptive/irt';
import type { Item } from '../../types';
import { normalizeText, type ItemParadigm } from '../paradigm';

export interface RatContent {
  words: [string, string, string];
}

interface RatItem {
  words: [string, string, string];
  answer: string;
  /** Provisional difficulty, ordered by the item writer's judgment. */
  b: number;
  practice?: boolean;
}

const ITEMS: RatItem[] = [
  { words: ['cottage', 'swiss', 'cake'], answer: 'cheese', b: -1.5, practice: true },
  { words: ['cream', 'skate', 'water'], answer: 'ice', b: -1.2, practice: true },
  { words: ['show', 'life', 'row'], answer: 'boat', b: -0.9 },
  { words: ['night', 'wrist', 'stop'], answer: 'watch', b: -0.7 },
  { words: ['flake', 'mobile', 'cone'], answer: 'snow', b: -0.6 },
  { words: ['worm', 'shelf', 'end'], answer: 'book', b: -0.3 },
  { words: ['dew', 'comb', 'bee'], answer: 'honey', b: -0.1 },
  { words: ['river', 'note', 'account'], answer: 'bank', b: 0.1 },
  { words: ['fish', 'mine', 'rush'], answer: 'gold', b: 0.2 },
  { words: ['duck', 'fold', 'dollar'], answer: 'bill', b: 0.4 },
  { words: ['salt', 'deep', 'foam'], answer: 'sea', b: 0.5 },
  { words: ['manners', 'round', 'tennis'], answer: 'table', b: 0.7 },
  { words: ['aid', 'rubber', 'wagon'], answer: 'band', b: 0.9 },
  { words: ['political', 'surprise', 'line'], answer: 'party', b: 1.0 },
  { words: ['board', 'magic', 'death'], answer: 'black', b: 1.2 },
  { words: ['stick', 'maker', 'point'], answer: 'match', b: 1.3 },
  { words: ['cane', 'daddy', 'plum'], answer: 'sugar', b: 1.5 },
  { words: ['sore', 'shoulder', 'sweat'], answer: 'cold', b: 1.7 },
  { words: ['age', 'mile', 'sand'], answer: 'stone', b: 1.9 },
  { words: ['pie', 'luck', 'belly'], answer: 'pot', b: 2.2 },
];

const accepted = (answer: string) => [answer, `${answer}s`, `${answer}es`];

function toItem(r: RatItem): Item<RatContent, string> {
  return {
    id: `rat:${r.answer}`,
    version: 1,
    paradigm: 'rat',
    domain: 'language',
    facet: 'remote-association',
    level: r.b,
    band: bandFor(r.b),
    irt: provisional(1.3, r.b, 0),
    timeLimitMs: 30_000,
    response: { kind: 'text', maxLength: 20, charset: 'letters' },
    content: { words: r.words },
    key: r.answer,
    features: { answer: r.answer },
    explanation: `${r.words.join(' · ')} → ${r.answer}`,
    source: { kind: 'authored', author: 'Classic CRA problem', reviewed: true },
  };
}

const live = ITEMS.filter((i) => !i.practice);

export const rat: ItemParadigm = {
  kind: 'items',
  id: 'rat',
  domain: 'language',
  group: 'creativity',
  title: 'Remote associates',
  subtitle: 'Three words. One hidden link.',
  construct: 'Convergent creative thinking: finding a remote association that links three cues.',
  instructions: [
    'Find one word that forms a common compound or phrase with each of the three words.',
    'Example: cottage · swiss · cake → cheese.',
    'Type the word and press Enter. You have 30 seconds; you can skip.',
  ],
  minutes: 5,
  minRtMs: 1500,
  candidates: (used) =>
    live.filter((i) => !used.includes(`rat:${i.answer}`)).map((i) => ({ key: i.answer, irt: { a: 1.3, b: i.b, c: 0 } })),
  instantiate: (key) => toItem(ITEMS.find((i) => i.answer === key)!) as Item,
  practice: (_rng, n) => ITEMS.filter((i) => i.practice).slice(0, n).map((i) => toItem(i) as Item),
  score: (item, value) => ({
    correct: value.kind === 'text' && accepted(String(item.key)).includes(normalizeText(value.value)),
  }),
  range: () => ({ minB: Math.min(...live.map((i) => i.b)), maxB: Math.max(...live.map((i) => i.b)) }),
};
