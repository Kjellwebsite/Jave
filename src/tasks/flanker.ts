import { z } from 'zod';
import { DIFFERENCE_CAVEAT, inverseEfficiency, metric, medianRt, ms, pct } from '../scoring/performance';
import { defineProcedure } from './define';

export interface FlankerTrial {
  direction: 'left' | 'right';
  congruent: boolean;
}

export const flanker = defineProcedure({
  id: 'flanker',
  domain: 'executive',
  group: 'performance',
  title: 'Interference control',
  subtitle: 'Follow the centre arrow. Ignore the rest.',
  construct: 'Resistance to response interference (Eriksen flanker).',
  instructions: [
    'Five arrows appear. Respond to the direction of the centre arrow only.',
    'Press F (or tap left) for ←, J (or tap right) for →.',
    'The outer arrows sometimes point the other way. Ignore them.',
  ],
  minutes: 3,
  input: 'keyboard-preferred',
  result: z.object({ trials: z.array(z.object({ response: z.enum(['left', 'right']).nullable(), rt: z.number().nullable() })) }),
  build(rng) {
    const trials: FlankerTrial[] = [];
    for (let i = 0; i < 96; i++) trials.push({ direction: i % 2 ? 'left' : 'right', congruent: Math.floor(i / 2) % 2 === 0 });
    return { trials: rng.shuffle(trials), itiMs: 700 };
  },
  score(config: { trials: FlankerTrial[] }, result) {
    const rows = config.trials.map((t, i) => ({ ...t, ...result.trials[i] }));
    const cond = (congruent: boolean) => {
      const r = rows.filter((x) => x.congruent === congruent && x.rt !== null);
      const correct = r.filter((x) => x.response === x.direction).map((x) => x.rt!);
      const acc = r.length ? correct.length / r.length : NaN;
      return { rt: medianRt(correct), acc, ies: inverseEfficiency(correct, acc) };
    };
    const c = cond(true);
    const inc = cond(false);
    return {
      metrics: [
        metric('effect-rt', 'Interference effect (RT)', inc.rt - c.rt, ms(inc.rt - c.rt), { caveat: DIFFERENCE_CAVEAT }),
        metric('effect-errors', 'Interference effect (errors)', c.acc - inc.acc, pct(c.acc - inc.acc, 1)),
        metric('effect-ies', 'Interference effect (inverse efficiency)', inc.ies - c.ies, ms(inc.ies - c.ies), { note: 'Combines speed and accuracy (Draheim et al., 2016)' }),
        metric('congruent-rt', 'Congruent RT', c.rt, ms(c.rt)),
        metric('incongruent-rt', 'Incongruent RT', inc.rt, ms(inc.rt)),
        metric('accuracy', 'Overall accuracy', rows.filter((r) => r.response === r.direction).length / rows.length, pct(rows.filter((r) => r.response === r.direction).length / rows.length)),
      ],
    };
  },
});
