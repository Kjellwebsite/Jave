import { z } from 'zod';
import { metric, pct } from '../scoring/performance';
import { defineProcedure } from './define';

/** Concrete, imageable nouns of similar frequency. */
const WORDS = ['anchor', 'lantern', 'violin', 'glacier', 'feather', 'compass', 'harbor', 'orchard', 'pebble', 'saddle', 'thimble', 'cactus', 'kettle', 'meadow', 'parcel', 'quarry', 'ribbon', 'tunnel', 'walrus', 'basket'];

export interface PairsConfig {
  /** Glyph seeds; the UI draws an abstract glyph from each seed. */
  glyphs: number[];
  words: string[];
  studyMs: number;
  rounds: number;
  /** For each cued recall trial: which pair, and the six word options (indices into `words`). */
  test: { pair: number; options: number[] }[];
}

function buildTest(n: number, rng: import('../utils/rng').Rng) {
  return rng.shuffle(Array.from({ length: n }, (_, i) => i)).map((pair) => ({
    pair,
    options: rng.shuffle([pair, ...rng.sample(Array.from({ length: n }, (_, i) => i).filter((j) => j !== pair), 5)]),
  }));
}

const recallResult = z.object({ choices: z.array(z.number().int().min(0).max(5).nullable()), rts: z.array(z.number()) });

export const pairsEncode = defineProcedure({
  id: 'pairsEncode',
  domain: 'memory',
  group: 'core',
  title: 'Associative encoding',
  subtitle: 'Learn which word belongs to which symbol.',
  construct: 'Associative learning with immediate cued recall. Delayed recall follows at the end of the session.',
  instructions: [
    'You will see eight symbols, each paired with a word. Study each pair.',
    'The pairs are shown twice. Then you choose the word that belongs to each symbol.',
    'You will be asked again, without warning, near the end of the assessment.',
  ],
  minutes: 3,
  result: recallResult,
  build(rng) {
    const words = rng.sample(WORDS, 8);
    return { glyphs: Array.from({ length: 8 }, () => rng.int(1, 2 ** 31)), words, studyMs: 3000, rounds: 2, test: buildTest(8, rng) } satisfies PairsConfig;
  },
  score(config: PairsConfig, result) {
    const correct = config.test.filter((t, i) => result.choices[i] !== null && t.options[result.choices[i]!] === t.pair).length;
    return {
      metrics: [metric('immediate', 'Immediate recall', correct / config.test.length, `${correct} of ${config.test.length}`)],
      detail: { immediate: correct / config.test.length },
    };
  },
});

export const pairsRecall = defineProcedure({
  id: 'pairsRecall',
  domain: 'memory',
  group: 'core',
  title: 'Delayed recall',
  subtitle: 'The symbols from earlier. Which word belonged to each?',
  construct: 'Retention of associations after a delay filled with other tasks.',
  instructions: ['Earlier you learned symbol–word pairs.', 'Choose the word that belonged to each symbol. There is no time pressure.'],
  minutes: 2,
  result: recallResult,
  build(rng, ctx) {
    const source = ctx.session.sections.find((s) => s.paradigm === 'pairsEncode');
    const cfg = source?.procedure?.config as PairsConfig | undefined;
    const immediate = (source?.procedure?.score?.detail?.immediate as number | undefined) ?? null;
    if (!cfg) return { available: false, glyphs: [], words: [], test: [], learnedAt: null, immediate };
    return { available: true, glyphs: cfg.glyphs, words: cfg.words, test: buildTest(cfg.words.length, rng), learnedAt: source?.finishedAt ?? null, immediate };
  },
  score(config: { available: boolean; words: string[]; test: PairsConfig['test']; learnedAt: number | null; immediate: number | null }, result) {
    if (!config.available) return { metrics: [metric('delayed', 'Delayed recall', NaN, '—', { status: 'insufficient', note: 'The encoding section was not completed' })] };
    const correct = config.test.filter((t, i) => result.choices[i] !== null && t.options[result.choices[i]!] === t.pair).length;
    const acc = correct / config.test.length;
    return {
      metrics: [
        metric('delayed', 'Delayed recall', acc, `${correct} of ${config.test.length}`),
        metric('retention', 'Retention ratio', config.immediate ? acc / config.immediate : NaN, config.immediate ? pct(acc / config.immediate) : '—', { note: 'Delayed ÷ immediate recall' }),
      ],
      detail: { learnedAt: config.learnedAt },
    };
  },
});
