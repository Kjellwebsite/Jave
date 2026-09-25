import { z } from 'zod';
import { cv, DEVICE_CAVEAT, metric, medianRt, ms, num, pct } from '../scoring/performance';
import { mean } from '../utils/stats';
import { defineProcedure } from './define';

export const SART_TARGET = 3;

export const sart = defineProcedure({
  id: 'sart',
  domain: 'attention',
  group: 'performance',
  title: 'Sustained attention',
  subtitle: 'Respond to every digit except 3.',
  construct: 'Sustained attention and response inhibition (SART; Robertson et al., 1997).',
  instructions: [
    'Digits appear one after another at a steady pace.',
    'Press Space (or tap) for every digit, except when it is a 3. Then do nothing.',
    'This takes about four minutes. Keep your attention on the stream.',
  ],
  minutes: 5,
  input: 'keyboard-preferred',
  result: z.object({ rts: z.array(z.number().nullable()) }),
  build(rng) {
    const digits: number[] = [];
    for (let block = 0; block < 25; block++) digits.push(...rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    return { digits, soaMs: 1150, displayMs: 250, fontSizes: digits.map(() => rng.pick([48, 72, 94, 100, 120])) };
  },
  score(config: { digits: number[] }, result) {
    const rows = config.digits.map((d, i) => ({ d, rt: result.rts[i] ?? null }));
    const nogo = rows.filter((r) => r.d === SART_TARGET);
    const go = rows.filter((r) => r.d !== SART_TARGET);
    const commissions = nogo.filter((r) => r.rt !== null).length;
    const omissions = go.filter((r) => r.rt === null).length;
    const goRts = go.filter((r) => r.rt !== null).map((r) => r.rt!);
    // RT speeding in the four go trials before each commission error.
    const pre: number[] = [];
    rows.forEach((r, i) => {
      if (r.d === SART_TARGET && r.rt !== null) {
        const before = rows.slice(Math.max(0, i - 4), i).filter((x) => x.d !== SART_TARGET && x.rt !== null).map((x) => x.rt!);
        if (before.length) pre.push(mean(before));
      }
    });
    const speeding = pre.length ? mean(goRts) - mean(pre) : NaN;
    return {
      metrics: [
        metric('commission', 'Commission errors', commissions / nogo.length, `${commissions} of ${nogo.length}`, { note: 'Responded to a 3' }),
        metric('omission', 'Omission errors', omissions / go.length, `${omissions} of ${go.length}`, { note: 'Missed a digit' }),
        metric('go-rt', 'Median response time', medianRt(goRts), ms(medianRt(goRts)), { caveat: DEVICE_CAVEAT }),
        metric('rt-cv', 'RT variability (CV)', cv(goRts), num(cv(goRts)), { note: 'Higher values indicate fluctuating attention' }),
        metric('pre-error', 'Speeding before errors', speeding, ms(speeding), { note: 'How much faster you responded just before a commission error' }),
        metric('accuracy', 'No-go accuracy', 1 - commissions / nogo.length, pct(1 - commissions / nogo.length)),
      ],
    };
  },
});
