import { z } from 'zod';
import { DIFFERENCE_CAVEAT, metric, medianRt, ms, num, pct } from '../scoring/performance';
import { defineProcedure } from './define';

export interface DualConfig {
  /** Shape discrimination trials: 0 = circle (F), 1 = square (J). */
  single: { shape: number; foreperiodMs: number }[];
  dual: { shape: number; foreperiodMs: number; flash: boolean }[];
  /** Count-only block: flash schedule (ms from block start). */
  countOnly: number[];
  countOnlyMs: number;
}

export const dualTask = defineProcedure({
  id: 'dualTask',
  domain: 'attention',
  group: 'performance',
  title: 'Dual task',
  subtitle: 'One task, the other, then both.',
  construct: 'Multitasking cost: performance under dual-task load compared with single-task baselines (Pashler, 1994).',
  instructions: [
    'Task A: a shape appears. Circle → F (or tap left), square → J (or tap right).',
    'Task B: count the small red flashes at the edge of the screen and report the total at the end.',
    'You do A alone, B alone, then both together. Keep both as accurate as you can.',
  ],
  minutes: 4,
  input: 'keyboard-preferred',
  result: z.object({
    single: z.array(z.object({ response: z.number().int().min(0).max(1).nullable(), rt: z.number().nullable() })),
    dual: z.array(z.object({ response: z.number().int().min(0).max(1).nullable(), rt: z.number().nullable() })),
    countOnlyReported: z.number().int().min(0).max(99),
    dualReported: z.number().int().min(0).max(99),
  }),
  build(rng) {
    const single = Array.from({ length: 24 }, () => ({ shape: rng.int(0, 1), foreperiodMs: rng.int(600, 1400) }));
    const dual = Array.from({ length: 24 }, () => ({ shape: rng.int(0, 1), foreperiodMs: rng.int(600, 1400), flash: rng.chance(0.4) }));
    const countOnlyMs = 30_000;
    const nFlashes = rng.int(8, 13);
    const countOnly = Array.from({ length: nFlashes }, (_, i) => Math.round(((i + 0.5) / nFlashes) * countOnlyMs + rng.int(-800, 800))).sort((a, b) => a - b);
    return { single, dual, countOnly, countOnlyMs } satisfies DualConfig;
  },
  score(config: DualConfig, result) {
    const perf = (trials: { shape: number }[], resp: { response: number | null; rt: number | null }[]) => {
      const correct = trials.map((t, i) => resp[i]?.response === t.shape);
      const acc = correct.filter(Boolean).length / trials.length;
      const rt = medianRt(resp.filter((r, i) => correct[i] && r.rt !== null).map((r) => r.rt!));
      return { acc, rt };
    };
    const s = perf(config.single, result.single);
    const d = perf(config.dual, result.dual);
    const countActualDual = config.dual.filter((t) => t.flash).length;
    const countErrSingle = Math.abs(result.countOnlyReported - config.countOnly.length) / config.countOnly.length;
    const countErrDual = Math.abs(result.dualReported - countActualDual) / Math.max(1, countActualDual);
    const pdtcRt = ((d.rt - s.rt) / s.rt) * 100;
    const pdtcAcc = ((s.acc - d.acc) / s.acc) * 100;
    return {
      metrics: [
        metric('rt-cost', 'Dual-task cost, speed', pdtcRt, `${num(pdtcRt, 0)}%`, { note: `Shape RT ${ms(s.rt)} alone → ${ms(d.rt)} with counting`, caveat: DIFFERENCE_CAVEAT }),
        metric('acc-cost', 'Dual-task cost, accuracy', pdtcAcc, `${num(pdtcAcc, 0)}%`, { note: `Shape accuracy ${pct(s.acc)} → ${pct(d.acc)}` }),
        metric('count-single', 'Counting error, alone', countErrSingle, pct(countErrSingle), { note: `${result.countOnlyReported} reported, ${config.countOnly.length} shown` }),
        metric('count-dual', 'Counting error, with shapes', countErrDual, pct(countErrDual), { note: `${result.dualReported} reported, ${countActualDual} shown` }),
      ],
    };
  },
});
