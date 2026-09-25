import { z } from 'zod';
import { metric } from '../scoring/performance';
import { defineProcedure } from './define';

const OBJECTS = ['brick', 'paperclip', 'shoe', 'newspaper', 'bucket', 'rope', 'spoon', 'umbrella'];

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const uses = defineProcedure({
  id: 'uses',
  domain: 'language',
  group: 'creativity',
  title: 'Alternative uses',
  subtitle: 'How many different uses can you think of?',
  construct: 'Divergent thinking (Guilford, 1967). Fluency is scored; originality and flexibility need rater or reference data.',
  instructions: [
    'An everyday object appears. List unusual, specific uses for it, one per line.',
    'Aim for ideas that are different from each other, not variations of one idea.',
    'You have 90 seconds per object. Press Enter after each idea.',
  ],
  minutes: 4,
  result: z.object({ responses: z.array(z.array(z.string().max(200)).max(80)) }),
  build(rng) {
    return { objects: rng.sample(OBJECTS, 2), durationMs: 90_000 };
  },
  score(config: { objects: string[] }, result) {
    const fluency = config.objects.map((_, i) => {
      const seen = new Set<string>();
      for (const r of result.responses[i] ?? []) {
        const n = normalize(r);
        if (n.split(' ').filter((w) => w.length > 1).length >= 1 && n.length >= 3) seen.add(n);
      }
      return seen.size;
    });
    const total = fluency.reduce((a, b) => a + b, 0);
    return {
      metrics: [
        metric('fluency', 'Fluency', total, `${total} ideas`, { note: config.objects.map((o, i) => `${o}: ${fluency[i]}`).join(' · '), caveat: 'Fluency depends on typing speed and correlates with originality counts; interpret with care (Silvia et al., 2008).' }),
        { id: 'originality', label: 'Originality', value: null, display: 'Calibration required', status: 'calibration-required', note: 'Needs trained raters or a reference distribution of other people’s answers.' },
        { id: 'flexibility', label: 'Flexibility', value: null, display: 'Calibration required', status: 'calibration-required', note: 'Needs a validated category scheme for uses.' },
      ],
      detail: { responses: result.responses, objects: config.objects },
    };
  },
});

export interface Constraint {
  kind: 'include' | 'exclude-letter' | 'words-exact' | 'start-letter' | 'no-repeat';
  value?: string | number;
  label: string;
}

export function checkConstraint(text: string, c: Constraint): boolean {
  const words: string[] = text.toLowerCase().match(/[a-z']+/g) ?? [];
  switch (c.kind) {
    case 'include':
      return words.includes(String(c.value).toLowerCase());
    case 'exclude-letter':
      return !text.toLowerCase().includes(String(c.value));
    case 'words-exact':
      return words.length === c.value;
    case 'start-letter':
      return words.length > 0 && words.every((w) => w.startsWith(String(c.value)));
    case 'no-repeat':
      return new Set(words).size === words.length;
  }
}

const PROMPTS: { task: string; constraints: Constraint[] }[] = [
  {
    task: 'Describe a city at night.',
    constraints: [
      { kind: 'words-exact', value: 8, label: 'Exactly 8 words' },
      { kind: 'exclude-letter', value: 'e', label: 'No letter “e”' },
    ],
  },
  {
    task: 'Invent a name and a one-line slogan for a bicycle repair shop.',
    constraints: [
      { kind: 'include', value: 'gravity', label: 'Uses the word “gravity”' },
      { kind: 'words-exact', value: 10, label: 'Exactly 10 words' },
      { kind: 'no-repeat', label: 'No word repeated' },
    ],
  },
  {
    task: 'Write a sentence about the ocean.',
    constraints: [
      { kind: 'start-letter', value: 's', label: 'Every word starts with “s”' },
      { kind: 'words-exact', value: 6, label: 'Exactly 6 words' },
    ],
  },
];

export const constrained = defineProcedure({
  id: 'constrained',
  domain: 'language',
  group: 'creativity',
  title: 'Constrained writing',
  subtitle: 'Create within strict rules.',
  construct: 'Constrained creativity. Constraint adherence is scored automatically; quality is not.',
  instructions: ['Each prompt has rules. Write one response that follows all of them.', 'The rules are checked automatically as you type.', 'There is no time limit, but aim for about a minute each.'],
  minutes: 4,
  result: z.object({ texts: z.array(z.string().max(500)) }),
  build() {
    return { prompts: PROMPTS };
  },
  score(config: { prompts: typeof PROMPTS }, result) {
    const checks = config.prompts.map((p, i) => p.constraints.map((c) => checkConstraint(result.texts[i] ?? '', c)));
    const all = checks.flat();
    const met = all.filter(Boolean).length;
    const perfect = checks.filter((cs) => cs.every(Boolean)).length;
    return {
      metrics: [
        metric('adherence', 'Constraints met', met / all.length, `${met} of ${all.length}`),
        metric('perfect', 'Fully compliant responses', perfect, `${perfect} of ${config.prompts.length}`),
        { id: 'quality', label: 'Creative quality', value: null, display: 'Not scored', status: 'not-scored', note: 'Quality needs human raters; JVLN does not use opaque AI judgments for scores.' },
      ],
      detail: { texts: result.texts },
    };
  },
});
