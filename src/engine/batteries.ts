import type { Mode, SectionPlan, StopRule } from '../types';

export const STOP: Record<Exclude<Mode, 'single'>, StopRule> = {
  quick: { minItems: 4, maxItems: 7, seTarget: 0.5, maxMs: 5 * 60_000 },
  core: { minItems: 5, maxItems: 9, seTarget: 0.42, maxMs: 6 * 60_000 },
  full: { minItems: 6, maxItems: 13, seTarget: 0.36, maxMs: 9 * 60_000 },
};

/** Paradigms that receive confidence probes (metacognition layer). */
const PROBED = new Set(['matrix', 'series', 'deduction', 'analogy', 'balance', 'probability']);

function section(paradigm: string, mode: Exclude<Mode, 'single'>, extra: Partial<SectionPlan> = {}): SectionPlan {
  const rate = PROBED.has(paradigm) ? (mode === 'full' ? 1 : 0.5) : 0;
  return { id: paradigm, paradigm, practice: 2, stop: STOP[mode], confidenceRate: rate, ...extra };
}

export const BATTERIES: Record<Exclude<Mode, 'single'>, { label: string; minutes: string; description: string; paradigms: string[] }> = {
  quick: {
    label: 'Quick',
    minutes: '20–25',
    description: 'Seven adaptive instruments across reasoning, quantitative, memory, executive and social domains.',
    paradigms: ['matrix', 'series', 'spatialSpan', 'deduction', 'balance', 'tower', 'beliefs'],
  },
  core: {
    label: 'Core',
    minutes: '50–65',
    description: 'All eleven domains with the principal instrument of each, delayed recall and embedded confidence ratings.',
    paradigms: [
      'pairsEncode',
      'matrix',
      'spatialSpan',
      'series',
      'category',
      'deduction',
      'balance',
      'beliefs',
      'verbalSpan',
      'tower',
      'rules',
      'probability',
      'language',
      'games',
      'social',
      'analogy',
      'semantic',
      'orientation',
      'reaction',
      'categoryRetain',
      'pairsRecall',
    ],
  },
  full: {
    label: 'Full',
    minutes: '100–130',
    description: 'Every instrument, including attention, performance, creativity and applied modules. Can be paused and resumed.',
    paradigms: [
      'pairsEncode',
      'matrix',
      'reaction',
      'series',
      'spatialSpan',
      'deduction',
      'category',
      'balance',
      'search',
      'beliefs',
      'verbalSpan',
      'probability',
      'flanker',
      'tower',
      'rules',
      'analogy',
      'switching',
      'games',
      'social',
      'nback',
      'language',
      'strategic',
      'sart',
      'semantic',
      'reading',
      'reversal',
      'orientation',
      'specimens',
      'dualTask',
      'rat',
      'uses',
      'constrained',
      'prompting',
      'layout',
      'typing',
      'categoryRetain',
      'pairsRecall',
    ],
  },
};

export function planFor(mode: Mode, paradigm?: string): SectionPlan[] {
  if (mode === 'single') {
    if (!paradigm) throw new Error('single mode needs a paradigm');
    return [section(paradigm, 'core', { confidenceRate: 0 })];
  }
  return BATTERIES[mode].paradigms.map((p) => section(p, mode));
}
