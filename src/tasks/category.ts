import { z } from 'zod';
import { provisional } from '../adaptive/irt';
import { metric, pct } from '../scoring/performance';
import type { ProcedureOutcome } from '../types';
import type { Rng } from '../utils/rng';
import { defineProcedure } from './define';

/** Four binary features: shape, fill, size, stripe. One is irrelevant in every problem. */
export type Stimulus = [number, number, number, number];

export type ProblemType = 'I' | 'II' | 'IV' | 'VI';

/** Shepard, Hovland & Jenkins (1961) structures over three relevant dimensions. */
const STRUCTURES: Record<ProblemType, (a: number, b: number, c: number) => number> = {
  I: (a) => a,
  II: (a, b) => a ^ b,
  IV: (a, b, c) => (a + b + c >= 2 ? 1 : 0),
  VI: (a, b, c) => a ^ b ^ c,
};

/** Provisional difficulty of reaching criterion and transferring (order from Nosofsky et al., 1994). */
export const PROBLEM_B: Record<ProblemType, number> = { I: -1.5, II: 0.2, IV: 0.6, VI: 2.0 };

export interface CategoryProblem {
  type: ProblemType;
  /** Stimulus dimension index for each of the three relevant slots, and the irrelevant one. */
  dims: [number, number, number];
  irrelevant: number;
  /** Swap labels so "A" is not always the feature-present group. */
  flip: number;
  train: Stimulus[];
  transfer: Stimulus[];
}

export interface CategoryConfig {
  problems: CategoryProblem[];
  blockSize: number;
  maxBlocks: number;
}

export const categoryOf = (p: CategoryProblem, s: Stimulus) => STRUCTURES[p.type](s[p.dims[0]], s[p.dims[1]], s[p.dims[2]]) ^ p.flip;

function makeProblem(type: ProblemType, rng: Rng): CategoryProblem {
  const order = rng.shuffle([0, 1, 2, 3]);
  const dims: [number, number, number] = [order[0], order[1], order[2]];
  const irrelevant = order[3];
  const train: Stimulus[] = [];
  const transfer: Stimulus[] = [];
  for (let m = 0; m < 8; m++) {
    const s: Stimulus = [0, 0, 0, 0];
    s[dims[0]] = m & 1;
    s[dims[1]] = (m >> 1) & 1;
    s[dims[2]] = (m >> 2) & 1;
    const v = rng.int(0, 1);
    const a: Stimulus = [...s] as Stimulus;
    const b: Stimulus = [...s] as Stimulus;
    a[irrelevant] = v;
    b[irrelevant] = 1 - v;
    train.push(a);
    transfer.push(b);
  }
  return { type, dims, irrelevant, flip: rng.int(0, 1), train, transfer };
}

/** Criterion: two consecutive perfect blocks. */
export function reachedCriterion(blockCorrect: number[], blockSize: number): number {
  for (let i = 1; i < blockCorrect.length; i++) if (blockCorrect[i] === blockSize && blockCorrect[i - 1] === blockSize) return i + 1;
  return -1;
}

const problemResult = z.object({
  training: z.array(z.object({ stimulus: z.number().int(), response: z.number().int().min(0).max(1).nullable(), rt: z.number() })),
  transfer: z.array(z.object({ stimulus: z.number().int(), response: z.number().int().min(0).max(1).nullable() })),
});

export const category = defineProcedure({
  id: 'category',
  domain: 'learning',
  group: 'core',
  title: 'Hidden-rule learning',
  subtitle: 'Learn the categories from feedback. Then generalise.',
  construct: 'Rule acquisition from feedback and transfer to unseen cases (Shepard, Hovland & Jenkins, 1961).',
  instructions: [
    'Objects belong to group A or group B by a hidden rule. Guess at first; feedback tells you if you were right.',
    'Learning ends after two perfect rounds of eight, or after six rounds.',
    'Then you sort eight new objects without feedback. One feature never matters.',
  ],
  minutes: 7,
  result: z.object({ problems: z.array(problemResult) }),
  build(rng, ctx) {
    const types: ProblemType[] = ctx.mode === 'quick' ? ['I', 'II'] : ['I', 'II', 'IV', 'VI'];
    return { problems: types.map((t, i) => makeProblem(t, rng.fork(i))), blockSize: 8, maxBlocks: 6 } satisfies CategoryConfig;
  },
  score(config: CategoryConfig, result) {
    const outcomes: ProcedureOutcome[] = [];
    const perProblem = config.problems.map((p, i) => {
      const r = result.problems[i];
      if (!r) return null;
      const blocks: number[] = [];
      r.training.forEach((t, j) => {
        const b = Math.floor(j / config.blockSize);
        blocks[b] = (blocks[b] ?? 0) + (t.response === categoryOf(p, p.train[t.stimulus]) ? 1 : 0);
      });
      const crit = reachedCriterion(blocks, config.blockSize);
      const errors = r.training.filter((t) => t.response !== categoryOf(p, p.train[t.stimulus])).length;
      const transferAcc = r.transfer.length ? r.transfer.filter((t) => t.response === categoryOf(p, p.transfer[t.stimulus])).length / r.transfer.length : 0;
      const solved = crit > 0 && transferAcc >= 7 / 8;
      outcomes.push({ itemId: `category:${p.type}`, facet: 'rule-learning', level: PROBLEM_B[p.type], irt: provisional(1.4, PROBLEM_B[p.type], 0), correct: solved });
      return { type: p.type, blocks, criterionBlock: crit, errors, transferAcc, solved };
    });
    const done = perProblem.filter((x): x is NonNullable<typeof x> => !!x);
    const transfer = done.length ? done.reduce((s, p) => s + p.transferAcc, 0) / done.length : NaN;
    return {
      outcomes,
      metrics: [
        metric('solved', 'Problems solved', done.filter((p) => p.solved).length, `${done.filter((p) => p.solved).length} of ${done.length}`, { note: 'Criterion reached and at least 7 of 8 transfer items correct' }),
        metric('transfer', 'Transfer accuracy', transfer, pct(transfer), { note: 'New objects, no feedback' }),
        ...done.map((p) =>
          metric(`errors-${p.type}`, `Errors to criterion, type ${p.type}`, p.errors, p.criterionBlock > 0 ? `${p.errors} (criterion in round ${p.criterionBlock})` : `${p.errors} (not reached)`),
        ),
      ],
      detail: { problems: done },
    };
  },
});

/** End-of-session retention probe for the first problem, without feedback. */
export const categoryRetain = defineProcedure({
  id: 'categoryRetain',
  domain: 'learning',
  group: 'core',
  title: 'Rule retention',
  subtitle: 'Remember the first rule you learned.',
  construct: 'Retention of a learned category rule after a delay.',
  instructions: [
    'Earlier you learned which objects belong to group A and group B.',
    'Sort these objects using that first rule. There is no feedback.',
  ],
  minutes: 1,
  result: z.object({ responses: z.array(z.number().int().min(0).max(1).nullable()), learnedAt: z.number().optional() }),
  build(rng, ctx) {
    const source = ctx.session.sections.find((s) => s.paradigm === 'category');
    const cfg = source?.procedure?.config as CategoryConfig | undefined;
    const problem = cfg?.problems[0] ?? makeProblem('I', rng);
    const stimuli = rng.shuffle([...problem.train, ...problem.transfer]).slice(0, 8);
    return { problem, stimuli, learnedAt: source?.finishedAt ?? null, available: !!cfg };
  },
  score(config: { problem: CategoryProblem; stimuli: Stimulus[]; learnedAt: number | null; available: boolean }, result) {
    const correct = config.stimuli.filter((s, i) => result.responses[i] === categoryOf(config.problem, s)).length;
    const acc = correct / config.stimuli.length;
    return {
      metrics: [
        metric('retention', 'Retention accuracy', acc, `${correct} of ${config.stimuli.length}`, {
          status: config.available ? 'ok' : 'insufficient',
          note: config.available ? 'First learned rule, tested at the end of the session' : 'The learning section was not completed',
        }),
      ],
    };
  },
});
