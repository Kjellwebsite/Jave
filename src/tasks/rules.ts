import { z } from 'zod';
import { metric, pct } from '../scoring/performance';
import type { Rng } from '../utils/rng';
import { defineProcedure } from './define';

export type RuleDim = 'color' | 'shape' | 'count';
export interface RuleCard {
  color: number;
  shape: number;
  count: number;
}

export const RULE_KEYS: RuleCard[] = [0, 1, 2, 3].map((i) => ({ color: i, shape: i, count: i }));
const RUN = 6;

export interface RulesConfig {
  deck: RuleCard[];
  order: RuleDim[];
}

/** Replay the choices and return per-trial feedback. Shared by engine and UI so feedback can't drift. */
export function replayRules(config: RulesConfig, choices: number[]) {
  let rule = 0;
  let run = 0;
  let previous: RuleDim | null = null;
  return choices.map((choice, i) => {
    const dim = config.order[Math.min(rule, config.order.length - 1)];
    const card = config.deck[i];
    const correct = card[dim] === choice;
    const perseverative = !correct && previous !== null && card[previous] === choice;
    const t = { dim, correct, perseverative, rule, finished: rule >= config.order.length };
    if (correct) {
      run++;
      if (run === RUN) {
        previous = dim;
        rule++;
        run = 0;
      }
    } else run = 0;
    return { ...t, completedRules: rule };
  });
}

function unambiguousDeck(rng: Rng, n: number): RuleCard[] {
  const all: RuleCard[] = [];
  for (let color = 0; color < 4; color++)
    for (let shape = 0; shape < 4; shape++)
      for (let count = 0; count < 4; count++) if (color !== shape && shape !== count && color !== count) all.push({ color, shape, count });
  const deck: RuleCard[] = [];
  while (deck.length < n) deck.push(...rng.shuffle(all));
  return deck.slice(0, n);
}

export const rules = defineProcedure({
  id: 'rules',
  domain: 'executive',
  group: 'core',
  title: 'Rule discovery',
  subtitle: 'Find the hidden sorting rule. Then find it again.',
  construct: 'Set shifting and rule discovery from feedback (card-sorting paradigm).',
  instructions: [
    'Sort each card onto one of the four key cards.',
    'Cards can match by tone, shape or count. Only one is correct, and nobody tells you which.',
    'After each choice you see whether it was right. The rule changes without warning.',
  ],
  minutes: 4,
  result: z.object({ choices: z.array(z.number().int().min(0).max(3)), rts: z.array(z.number()) }),
  build(rng) {
    const first = rng.shuffle<RuleDim>(['color', 'shape', 'count']);
    return { deck: unambiguousDeck(rng, 64), order: [...first, ...first] } satisfies RulesConfig;
  },
  score(config: RulesConfig, result) {
    const replay = replayRules(config, result.choices);
    const n = replay.length;
    const completed = replay.length ? replay[n - 1].completedRules : 0;
    const persev = replay.filter((r) => r.perseverative).length;
    const firstRule = replay.findIndex((r) => r.completedRules >= 1) + 1;
    const afterError = replay.slice(1).filter((_, i) => !replay[i].correct);
    const postErr = afterError.length ? afterError.filter((r) => r.correct).length / afterError.length : NaN;
    const acc = n ? replay.filter((r) => r.correct).length / n : NaN;
    return {
      metrics: [
        metric('rules', 'Rules found', completed, `${completed} of ${config.order.length}`),
        metric('perseverative', 'Perseverative errors', persev, String(persev), { note: 'Errors that follow the previous rule after it changed' }),
        metric('first', 'Cards to first rule', firstRule || NaN, firstRule ? String(firstRule) : '—'),
        metric('post-error', 'Accuracy after an error', postErr, pct(postErr)),
        metric('accuracy', 'Overall accuracy', acc, pct(acc)),
      ],
    };
  },
});
