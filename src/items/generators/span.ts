/**
 * Working-memory span paradigms. Each trial is one IRT item whose difficulty
 * grows with sequence length. Backward Corsi is not harder than forward
 * (Kessels et al., 2008), so spatial span uses one difficulty model.
 */
import { defaultCheck, generatorParadigm, type LevelSpec } from '../paradigm';

/** Irregular block layout in percent of the board (top-left corner). */
export const CORSI_LAYOUT: [number, number][] = [
  [8, 60], [22, 14], [36, 42], [28, 80], [55, 64], [58, 24], [80, 8], [82, 46], [70, 82],
];

export interface SpatialSpanContent {
  sequence: number[];
  onMs: number;
  offMs: number;
}

export interface VerbalSpanContent {
  sequence: string[];
  mode: 'reverse' | 'sort';
  itemMs: number;
}

const SPATIAL_LEVELS: LevelSpec[] = [3, 4, 5, 6, 7, 8, 9, 10].map((len) => ({
  level: len,
  a: 1.6,
  b: Math.round(0.8 * (len - 6) * 100) / 100,
  c: 0,
  timeLimitMs: 30_000 + len * 3_000,
}));

export const spatialSpan = generatorParadigm<SpatialSpanContent, string>({
  id: 'spatialSpan',
  version: 1,
  domain: 'memory',
  group: 'core',
  facet: 'spatial-wm',
  title: 'Spatial sequence',
  subtitle: 'Observe the path. Reproduce it.',
  construct: 'Visuospatial working memory: holding an ordered sequence of locations.',
  instructions: [
    'Blocks light up one at a time. Watch the order.',
    'When the sequence ends, select the blocks in the same order.',
    'Sequences adapt to your performance and can become long.',
  ],
  minutes: 4,
  minRtMs: 300,
  levels: SPATIAL_LEVELS,
  practiceLevels: [3],
  generate(level, rng) {
    const sequence: number[] = [];
    while (sequence.length < level) {
      const b = rng.int(0, CORSI_LAYOUT.length - 1);
      if (!sequence.includes(b)) sequence.push(b);
    }
    return {
      content: { sequence, onMs: 700, offMs: 250 },
      key: sequence.join(''),
      response: { kind: 'text', maxLength: 12, charset: 'any' },
      features: { length: level },
      explanation: `Sequence: ${sequence.map((b) => b + 1).join(' → ')}`,
    };
  },
});

/** Phonologically distinct consonants (no rhyming B/C/D/E/G/P/T/V set). */
const LETTERS = ['F', 'H', 'J', 'K', 'L', 'N', 'Q', 'R', 'S', 'X', 'Y'];
const DIGITS = ['2', '3', '4', '5', '6', '7', '8', '9'];

const VERBAL_LEVELS: LevelSpec[] = [
  ...[3, 4, 5, 6, 7, 8, 9].map((len, i) => ({ level: i + 1, a: 1.6, b: Math.round(0.8 * (len - 5.2) * 100) / 100, c: 0, timeLimitMs: 45_000 })),
  ...[5, 6, 7, 8].map((len, i) => ({ level: 8 + i, a: 1.7, b: Math.round((0.8 * (len - 5.2) + 0.6) * 100) / 100, c: 0, timeLimitMs: 60_000 })),
];

export const verbalSpan = generatorParadigm<VerbalSpanContent, string>({
  id: 'verbalSpan',
  version: 1,
  domain: 'memory',
  group: 'core',
  facet: 'verbal-wm',
  title: 'Verbal manipulation',
  subtitle: 'Hold the sequence. Transform it.',
  construct: 'Verbal working memory with manipulation: storing and reordering a sequence.',
  instructions: [
    'Characters appear one at a time.',
    'Type them in reverse order: the last one first.',
    'Longer items mix digits and letters: type the digits in ascending order, then the letters in alphabetical order.',
  ],
  minutes: 4,
  minRtMs: 400,
  levels: VERBAL_LEVELS,
  practiceLevels: [1, 8],
  generate(level, rng) {
    const sort = level >= 8;
    const len = sort ? level - 3 : level + 2;
    let sequence: string[];
    if (sort) {
      const nDigits = rng.int(2, len - 2);
      sequence = rng.shuffle([...rng.sample(DIGITS, nDigits), ...rng.sample(LETTERS, len - nDigits)]);
    } else {
      sequence = rng.sample(LETTERS, len);
    }
    const key = sort
      ? [...sequence.filter((c) => /\d/.test(c)).sort(), ...sequence.filter((c) => /[A-Z]/.test(c)).sort()].join('')
      : [...sequence].reverse().join('');
    return {
      content: { sequence, mode: sort ? 'sort' : 'reverse', itemMs: 900 },
      key,
      response: { kind: 'text', maxLength: 12, charset: 'alnum' },
      features: { length: len, mode: sort ? 'sort' : 'reverse' },
      explanation: `Answer: ${key}`,
    };
  },
  check: (item, value) => defaultCheck(item, value),
});
