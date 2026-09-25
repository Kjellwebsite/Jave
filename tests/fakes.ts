/** Synthetic participants for integration tests. */
import { getParadigm, isItemParadigm } from '../src/engine/registry';
import { probability } from '../src/adaptive/irt';
import type { Item, PendingStep, ResponseValue } from '../src/types';
import type { Rng } from '../src/utils/rng';
import { replayRules, type RulesConfig } from '../src/tasks/rules';
import { categoryOf, type CategoryConfig } from '../src/tasks/category';

/** Answer an item correctly with 3PL probability at `theta`, otherwise give a wrong answer of the right type. */
export function answerItem(item: Item, theta: number, rng: Rng): ResponseValue {
  const correct = rng.next() < probability(theta, item.irt);
  const r = item.response;
  if (r.kind === 'choice') {
    const k = item.key as number;
    return { kind: 'choice', index: correct ? k : (k + 1 + rng.int(0, r.options - 2)) % r.options };
  }
  if (r.kind === 'number') return { kind: 'number', value: correct ? (item.key as number) : (item.key as number) + 1 };
  return { kind: 'text', value: correct ? String(item.key) : `${String(item.key)}x` };
}

export function controlAnswer(item: Item): ResponseValue | undefined {
  const c = (item.content as { control?: { key: number } }).control;
  return c ? { kind: 'choice', index: c.key } : undefined;
}

/** A plausible, schema-valid result for each procedure. */
export function fakeProcedure(paradigm: string, config: any, rng: Rng): unknown {
  const rt = () => 300 + rng.int(0, 400);
  switch (paradigm) {
    case 'reaction':
      return {
        simple: config.simple.map(() => ({ rt: 250 + rng.int(0, 80), anticipation: false, response: null })),
        choice: config.choice.map((t: { target: number }) => ({ rt: rt(), anticipation: false, response: rng.chance(0.93) ? t.target : (t.target + 1) % 4 })),
      };
    case 'search':
      return { trials: config.trials.map((t: { setSize: number; present: boolean }) => ({ response: rng.chance(0.95) ? t.present : !t.present, rt: 450 + t.setSize * (t.present ? 25 : 50) + rng.int(0, 150) })) };
    case 'sart':
      return { rts: config.digits.map((d: number) => (d === 3 ? (rng.chance(0.3) ? 320 : null) : rng.chance(0.97) ? rt() : null)) };
    case 'flanker':
      return { trials: config.trials.map((t: { direction: string; congruent: boolean }) => ({ response: rng.chance(0.95) ? t.direction : t.direction === 'left' ? 'right' : 'left', rt: rt() + (t.congruent ? 0 : 50) })) };
    case 'switching':
      return { trials: config.trials.map(() => ({ response: rng.chance(0.5) ? 'left' : 'right', rt: rt() })) };
    case 'rules': {
      const cfg = config as RulesConfig;
      const choices: number[] = [];
      while (choices.length < cfg.deck.length) {
        const replay = replayRules(cfg, choices);
        if (replay.length && replay[replay.length - 1].completedRules >= cfg.order.length) break;
        const dim = cfg.order[Math.min(replay.length ? replay[replay.length - 1].completedRules : 0, cfg.order.length - 1)];
        const card = cfg.deck[choices.length];
        choices.push(rng.chance(0.8) ? card[dim] : rng.int(0, 3));
      }
      return { choices, rts: choices.map(rt) };
    }
    case 'category': {
      const cfg = config as CategoryConfig;
      return {
        problems: cfg.problems.map((p, pi) => ({
          training: Array.from({ length: 24 }, (_, j) => ({ stimulus: j % 8, response: rng.chance(pi < 2 ? 0.95 : 0.6) ? categoryOf(p, p.train[j % 8]) : 1 - categoryOf(p, p.train[j % 8]), rt: rt() })),
          transfer: p.transfer.map((s, j) => ({ stimulus: j, response: rng.chance(pi < 2 ? 0.95 : 0.6) ? categoryOf(p, s) : 1 - categoryOf(p, s) })),
        })),
      };
    }
    case 'categoryRetain':
      return { responses: config.stimuli.map((s: any) => categoryOf(config.problem, s)) };
    case 'reversal':
      return { choices: config.probs.map((p: number[]) => (rng.chance(0.75) ? p.indexOf(0.8) : rng.int(0, 2))), rts: config.probs.map(rt) };
    case 'nback':
      return { blocks: config.blocks.map((b: { target: boolean[] }) => ({ responses: b.target.map((t: boolean) => (t ? rng.chance(0.8) : rng.chance(0.1))) })) };
    case 'pairsEncode':
    case 'pairsRecall':
      return { choices: (config.test ?? []).map((t: { pair: number; options: number[] }) => (rng.chance(0.8) ? t.options.indexOf(t.pair) : 0)), rts: (config.test ?? []).map(rt) };
    case 'dualTask':
      return {
        single: config.single.map((t: { shape: number }) => ({ response: t.shape, rt: rt() })),
        dual: config.dual.map((t: { shape: number }) => ({ response: rng.chance(0.9) ? t.shape : 1 - t.shape, rt: rt() + 80 })),
        countOnlyReported: config.countOnly.length,
        dualReported: config.dual.filter((t: { flash: boolean }) => t.flash).length + 1,
      };
    case 'typing':
      return { typed: config.text.slice(0, 180), elapsedMs: 60_000, backspaces: 4 };
    case 'uses':
      return { responses: config.objects.map(() => ['build a small wall', 'use as a doorstop', 'grind into pigment']) };
    case 'constrained':
      return { texts: config.prompts.map(() => 'a short response here') };
    default:
      throw new Error(`no fake for ${paradigm}`);
  }
}

export const isItemStep = (s: PendingStep | { type: string }): s is Extract<PendingStep, { type: 'item' | 'practice' }> => s.type === 'item' || s.type === 'practice';
export const paradigmIsItems = (id: string) => isItemParadigm(getParadigm(id));
