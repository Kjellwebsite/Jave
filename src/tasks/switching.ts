import { z } from 'zod';
import { DIFFERENCE_CAVEAT, metric, medianRt, ms, num, pct } from '../scoring/performance';
import { defineProcedure } from './define';

export type SwitchTask = 'parity' | 'magnitude';
export interface SwitchTrial {
  task: SwitchTask;
  digit: number;
  block: number;
  mixed: boolean;
}

/** F = left: odd / below 5. J = right: even / above 5. */
export const correctSide = (t: { task: SwitchTask; digit: number }): 'left' | 'right' =>
  t.task === 'parity' ? (t.digit % 2 ? 'left' : 'right') : t.digit < 5 ? 'left' : 'right';

const DIGITS = [1, 2, 3, 4, 6, 7, 8, 9];

export const switching = defineProcedure({
  id: 'switching',
  domain: 'executive',
  group: 'performance',
  title: 'Task switching',
  subtitle: 'Two rules. The cue tells you which.',
  construct: 'Cognitive flexibility: the cost of switching between task sets (Monsell, 2003).',
  instructions: [
    'A digit appears inside a frame. A circle frame means ODD or EVEN, a square frame means LOW (1–4) or HIGH (6–9).',
    'Odd or low: press F (or tap left). Even or high: press J (or tap right).',
    'First you practise each rule alone, then the rules mix unpredictably.',
  ],
  minutes: 4,
  input: 'keyboard-preferred',
  result: z.object({ trials: z.array(z.object({ response: z.enum(['left', 'right']).nullable(), rt: z.number().nullable() })) }),
  build(rng) {
    const trials: SwitchTrial[] = [];
    const pure = (task: SwitchTask, block: number) => {
      for (let i = 0; i < 20; i++) trials.push({ task, digit: rng.pick(DIGITS), block, mixed: false });
    };
    pure('parity', 0);
    pure('magnitude', 1);
    let task: SwitchTask = rng.pick(['parity', 'magnitude']);
    for (let i = 0; i < 64; i++) {
      if (i > 0 && rng.chance(0.5)) task = task === 'parity' ? 'magnitude' : 'parity';
      trials.push({ task, digit: rng.pick(DIGITS), block: 2, mixed: true });
    }
    return { trials, ctiMs: 400, itiMs: 500 };
  },
  score(config: { trials: SwitchTrial[] }, result) {
    const rows = config.trials.map((t, i) => ({
      ...t,
      ...result.trials[i],
      correct: result.trials[i]?.response === correctSide(t),
      switched: t.mixed && i > 0 && config.trials[i - 1].mixed && config.trials[i - 1].task !== t.task,
      repeat: t.mixed && i > 0 && config.trials[i - 1].mixed && config.trials[i - 1].task === t.task,
    }));
    const rt = (rs: typeof rows) => medianRt(rs.filter((r) => r.correct && r.rt !== null).map((r) => r.rt!));
    const acc = (rs: typeof rows) => (rs.length ? rs.filter((r) => r.correct).length / rs.length : NaN);
    const sw = rows.filter((r) => r.switched);
    const rep = rows.filter((r) => r.repeat);
    const pureRows = rows.filter((r) => !r.mixed);
    // Bin score (Draheim et al., 2016): rank switch trials against the person's own repeat RT distribution.
    const repRts = rep.filter((r) => r.correct && r.rt !== null).map((r) => r.rt!).sort((a, b) => a - b);
    const bins = sw.map((r) => {
      if (!r.correct || r.rt === null) return 20;
      const below = repRts.filter((x) => x < r.rt!).length;
      return Math.min(10, Math.floor((below / Math.max(1, repRts.length)) * 10) + 1);
    });
    const binScore = bins.length ? bins.reduce((s, b) => s + b, 0) / bins.length : NaN;
    return {
      metrics: [
        metric('switch-rt', 'Switch cost (RT)', rt(sw) - rt(rep), ms(rt(sw) - rt(rep)), { caveat: DIFFERENCE_CAVEAT }),
        metric('switch-err', 'Switch cost (errors)', acc(rep) - acc(sw), pct(acc(rep) - acc(sw), 1)),
        metric('mixing-rt', 'Mixing cost (RT)', rt(rep) - rt(pureRows), ms(rt(rep) - rt(pureRows)), { note: 'Repeat trials in mixed blocks vs pure blocks', caveat: DIFFERENCE_CAVEAT }),
        metric('bin', 'Bin score', binScore, num(binScore, 1), { note: 'Switch trials ranked against your own repeat trials, 1–10 (errors count 20). Lower is better.' }),
        metric('accuracy', 'Mixed-block accuracy', acc(rows.filter((r) => r.mixed)), pct(acc(rows.filter((r) => r.mixed)))),
      ],
    };
  },
});
