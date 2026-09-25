import { z } from 'zod';
import { DEVICE_CAVEAT, DIFFERENCE_CAVEAT, metric, ms, num, pct } from '../scoring/performance';
import { ols } from '../utils/stats';
import { defineProcedure } from './define';

export interface SearchTrial {
  setSize: number;
  present: boolean;
  seed: number;
}

export const SET_SIZES = [4, 8, 16, 24];

export const search = defineProcedure({
  id: 'search',
  domain: 'attention',
  group: 'performance',
  title: 'Visual search',
  subtitle: 'Is the T there?',
  construct: 'Efficiency of serial visual search (conjunction-like T among L).',
  instructions: [
    'A field of rotated letters appears. Decide whether it contains a T.',
    'Press J (or tap Present) if there is a T, F (or tap Absent) if there is none.',
    'Be fast but accurate.',
  ],
  minutes: 3,
  input: 'keyboard-preferred',
  result: z.object({ trials: z.array(z.object({ response: z.boolean().nullable(), rt: z.number().nullable() })) }),
  build(rng) {
    const trials: SearchTrial[] = [];
    for (const setSize of SET_SIZES) for (let i = 0; i < 20; i++) trials.push({ setSize, present: i % 2 === 0, seed: rng.int(1, 2 ** 31) });
    return { trials: rng.shuffle(trials) };
  },
  score(config: { trials: SearchTrial[] }, result) {
    const rows = config.trials.map((t, i) => ({ ...t, ...result.trials[i] }));
    const correct = rows.filter((r) => r.rt !== null && r.response === r.present && r.rt >= 150);
    const slope = (present: boolean) => {
      const c = correct.filter((r) => r.present === present);
      return ols(c.map((r) => r.setSize), c.map((r) => r.rt!));
    };
    const pres = slope(true);
    const abs = slope(false);
    const acc = rows.filter((r) => r.response === r.present).length / rows.length;
    return {
      metrics: [
        metric('slope-present', 'Search slope, target present', pres.slope, `${num(pres.slope, 1)} ms/item`, { unit: 'ms/item', caveat: DIFFERENCE_CAVEAT }),
        metric('slope-absent', 'Search slope, target absent', abs.slope, `${num(abs.slope, 1)} ms/item`, { unit: 'ms/item' }),
        metric('intercept', 'Intercept', pres.intercept, ms(pres.intercept), { caveat: DEVICE_CAVEAT }),
        metric('accuracy', 'Accuracy', acc, pct(acc)),
      ],
      detail: {
        bySize: [4, 8, 16, 24].map((n) => ({
          setSize: n,
          present: correct.filter((r) => r.present && r.setSize === n).map((r) => r.rt!),
          absent: correct.filter((r) => !r.present && r.setSize === n).map((r) => r.rt!),
        })),
      },
    };
  },
});
