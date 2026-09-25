import { z } from 'zod';
import { cleanRts, cv, DEVICE_CAVEAT, inverseEfficiency, metric, medianRt, ms, num, pct } from '../scoring/performance';
import { defineProcedure } from './define';

export interface ReactionConfig {
  simple: { foreperiodMs: number }[];
  choice: { foreperiodMs: number; target: number }[];
}

const trial = z.object({ rt: z.number().nullable(), anticipation: z.boolean(), response: z.number().int().min(0).max(3).nullable().optional() });

export const reaction = defineProcedure({
  id: 'reaction',
  domain: 'attention',
  group: 'performance',
  title: 'Reaction',
  subtitle: 'Respond the moment the signal appears.',
  construct: 'Simple and four-choice reaction time, response consistency and anticipations.',
  instructions: [
    'Part one: press Space (or tap the panel) as soon as the dot appears.',
    'Part two: four positions. Press D, F, J or K (or tap the position) where the dot appears.',
    'Responding before the dot appears counts as an anticipation.',
  ],
  minutes: 3,
  input: 'keyboard-preferred',
  result: z.object({ simple: z.array(trial), choice: z.array(trial) }),
  build(rng) {
    return {
      simple: Array.from({ length: 20 }, () => ({ foreperiodMs: rng.int(800, 2200) })),
      choice: Array.from({ length: 40 }, () => ({ foreperiodMs: rng.int(800, 2200), target: rng.int(0, 3) })),
    } satisfies ReactionConfig;
  },
  score(config, result) {
    const simpleRts = result.simple.filter((t) => !t.anticipation && t.rt !== null).map((t) => t.rt!);
    const choiceTrials = result.choice.map((t, i) => ({ ...t, target: config.choice[i]?.target }));
    const correct = choiceTrials.filter((t) => !t.anticipation && t.rt !== null && t.response === t.target);
    const answered = choiceTrials.filter((t) => !t.anticipation && t.rt !== null);
    const acc = answered.length ? correct.length / answered.length : NaN;
    const choiceRts = correct.map((t) => t.rt!);
    const anticipations = [...result.simple, ...result.choice].filter((t) => t.anticipation).length;
    return {
      metrics: [
        metric('simple-rt', 'Simple reaction time', medianRt(simpleRts), ms(medianRt(simpleRts)), { unit: 'ms', note: `Median of ${cleanRts(simpleRts).length} trials`, caveat: DEVICE_CAVEAT }),
        metric('choice-rt', 'Choice reaction time', medianRt(choiceRts), ms(medianRt(choiceRts)), { unit: 'ms', note: 'Four alternatives, correct trials', caveat: DEVICE_CAVEAT }),
        metric('choice-accuracy', 'Choice accuracy', acc, pct(acc)),
        metric('consistency', 'Response consistency (CV)', cv(simpleRts), num(cv(simpleRts)), { note: 'Coefficient of variation of simple RT. Lower is steadier.' }),
        metric('ies', 'Inverse efficiency', inverseEfficiency(choiceRts, acc), ms(inverseEfficiency(choiceRts, acc)), { note: 'Choice RT ÷ accuracy (speed–accuracy combined)' }),
        metric('anticipations', 'Anticipations', anticipations, String(anticipations)),
      ],
    };
  },
});
