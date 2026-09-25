import { z } from 'zod';
import { dPrime, metric, num, pct } from '../scoring/performance';
import type { Rng } from '../utils/rng';
import { defineProcedure } from './define';

const LETTERS = ['F', 'H', 'J', 'K', 'L', 'N', 'Q', 'R', 'S', 'X'];

export interface NBackBlock {
  n: number;
  letters: string[];
  target: boolean[];
  lure: boolean[];
}

function makeBlock(n: number, rng: Rng): NBackBlock {
  const len = 30 + n;
  for (;;) {
    const letters: string[] = [];
    for (let i = 0; i < len; i++) {
      if (i >= n && rng.chance(0.3)) letters.push(letters[i - n]);
      else if (i >= n - 1 && i > 0 && rng.chance(0.12)) letters.push(letters[i - (n - 1)] ?? rng.pick(LETTERS));
      else letters.push(rng.pick(LETTERS));
    }
    const target = letters.map((l, i) => i >= n && l === letters[i - n]);
    const lure = letters.map((l, i) => !target[i] && ((i >= n - 1 && n > 1 && l === letters[i - (n - 1)]) || (i >= n + 1 && l === letters[i - (n + 1)])));
    const t = target.filter(Boolean).length;
    if (t >= 8 && t <= 11 && lure.filter(Boolean).length >= 3) return { n, letters, target, lure };
  }
}

export const nback = defineProcedure({
  id: 'nback',
  domain: 'memory',
  group: 'performance',
  title: 'Updating (n-back)',
  subtitle: 'Does this letter match the one n steps back?',
  construct: 'Working-memory updating. Reported as d′ only: n-back has low reliability for individuals (Jaeggi et al., 2010).',
  instructions: [
    'Letters appear one at a time.',
    'Press Space (or tap Match) when the letter is the same as the one shown n steps earlier.',
    'Two blocks: 2-back, then 3-back. Some letters are deliberate near-misses.',
  ],
  minutes: 4,
  input: 'keyboard-preferred',
  result: z.object({ blocks: z.array(z.object({ responses: z.array(z.boolean()) })) }),
  build(rng) {
    return { blocks: [makeBlock(2, rng), makeBlock(3, rng)], itemMs: 500, soaMs: 2500 };
  },
  score(config: { blocks: NBackBlock[] }, result) {
    const metrics = config.blocks.flatMap((b, i) => {
      const resp = result.blocks[i]?.responses ?? [];
      const signals = b.target.filter(Boolean).length;
      const noise = b.target.length - signals;
      const hits = b.target.filter((t, j) => t && resp[j]).length;
      const fas = b.target.filter((t, j) => !t && resp[j]).length;
      const lureFas = b.lure.filter((l, j) => l && resp[j]).length;
      const lures = b.lure.filter(Boolean).length;
      return [
        metric(`d-${b.n}`, `${b.n}-back sensitivity (d′)`, dPrime(hits, signals, fas, noise), num(dPrime(hits, signals, fas, noise))),
        metric(`hits-${b.n}`, `${b.n}-back hits`, hits / signals, `${hits} of ${signals}`),
        metric(`lure-${b.n}`, `${b.n}-back lure false alarms`, lures ? lureFas / lures : NaN, lures ? pct(lureFas / lures) : '—', { note: 'Responding to near-misses signals familiarity-based responding' }),
      ];
    });
    return { metrics };
  },
});
