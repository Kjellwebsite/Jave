import { z } from 'zod';
import { metric, num, pct } from '../scoring/performance';
import { mean } from '../utils/stats';
import { defineProcedure } from './define';

export interface ReversalConfig {
  /** Reward probability per option per trial. */
  probs: number[][];
  /** Pre-sampled outcome if option k is chosen on trial t (deterministic across replays). */
  outcomes: boolean[][];
  reversals: number[];
}

/** Rescorla–Wagner with softmax choice; negative log-likelihood of a choice sequence. */
export function rwNll(choices: number[], rewards: boolean[], alpha: number, beta: number): number {
  const q = [0.5, 0.5, 0.5];
  let nll = 0;
  for (let t = 0; t < choices.length; t++) {
    const exps = q.map((v) => Math.exp(beta * v));
    const z = exps.reduce((a, b) => a + b, 0);
    nll -= Math.log(Math.max(exps[choices[t]] / z, 1e-12));
    q[choices[t]] += alpha * ((rewards[t] ? 1 : 0) - q[choices[t]]);
  }
  return nll;
}

export function fitRw(choices: number[], rewards: boolean[]) {
  let best = { alpha: NaN, beta: NaN, nll: Infinity };
  for (let i = 1; i <= 50; i++)
    for (let j = 1; j <= 50; j++) {
      const alpha = i / 50;
      const beta = j * 0.4;
      const nll = rwNll(choices, rewards, alpha, beta);
      if (nll < best.nll) best = { alpha, beta, nll };
    }
  return best;
}

export const reversal = defineProcedure({
  id: 'reversal',
  domain: 'learning',
  group: 'performance',
  title: 'Adaptive choice',
  subtitle: 'Find the best option. Notice when it changes.',
  construct: 'Feedback-based learning and adaptation to changing reward contingencies.',
  instructions: [
    'Choose one of three symbols. Each pays a point with its own hidden probability.',
    'Collect as many points as you can. The best symbol changes from time to time.',
    'Keys 1, 2, 3 or tap.',
  ],
  minutes: 4,
  result: z.object({ choices: z.array(z.number().int().min(0).max(2)), rts: z.array(z.number()) }),
  build(rng) {
    const n = 160;
    const reversals: number[] = [];
    let t = rng.int(25, 35);
    while (t < n - 15) {
      reversals.push(t);
      t += rng.int(25, 35);
    }
    let assignment = rng.shuffle([0.8, 0.5, 0.2]);
    const probs: number[][] = [];
    for (let i = 0; i < n; i++) {
      if (reversals.includes(i)) {
        const best = assignment.indexOf(0.8);
        let next = assignment;
        while (next.indexOf(0.8) === best) next = rng.shuffle([0.8, 0.5, 0.2]);
        assignment = next;
      }
      probs.push(assignment);
    }
    const outcomes = probs.map((p) => p.map((x) => rng.chance(x)));
    return { probs, outcomes, reversals } satisfies ReversalConfig;
  },
  score(config: ReversalConfig, result) {
    const n = result.choices.length;
    const rewards = result.choices.map((c, t) => config.outcomes[t][c]);
    const best = result.choices.map((_, t) => config.probs[t].indexOf(Math.max(...config.probs[t])));
    const acc = n ? result.choices.filter((c, t) => c === best[t]).length / n : NaN;
    const adapt = config.reversals
      .filter((r) => r < n)
      .map((r) => {
        for (let t = r; t < n - 2; t++) if (result.choices[t] === best[t] && result.choices[t + 1] === best[t + 1] && result.choices[t + 2] === best[t + 2]) return t - r;
        return n - r;
      });
    let ws = 0;
    let wsN = 0;
    let ls = 0;
    let lsN = 0;
    for (let t = 1; t < n; t++) {
      if (rewards[t - 1]) {
        wsN++;
        if (result.choices[t] === result.choices[t - 1]) ws++;
      } else {
        lsN++;
        if (result.choices[t] !== result.choices[t - 1]) ls++;
      }
    }
    const fit = fitRw(result.choices, rewards);
    const points = rewards.filter(Boolean).length;
    return {
      metrics: [
        metric('points', 'Points', points, `${points} of ${n}`),
        metric('best', 'Chose the best option', acc, pct(acc)),
        metric('adapt', 'Trials to adapt after a change', mean(adapt), num(mean(adapt), 1), { note: 'Until three consecutive best choices' }),
        metric('win-stay', 'Win–stay', ws / wsN, pct(ws / wsN)),
        metric('lose-shift', 'Lose–shift', ls / lsN, pct(ls / lsN)),
        metric('alpha', 'Learning rate α', fit.alpha, num(fit.alpha), {
          note: 'Rescorla–Wagner model fit. Higher means recent outcomes weigh more.',
          caveat: 'Single-session parameter estimates are noisy; hierarchical estimation across many people is more reliable (Waltmann et al., 2022).',
        }),
        metric('beta', 'Choice consistency β', fit.beta, num(fit.beta, 1)),
      ],
    };
  },
});
