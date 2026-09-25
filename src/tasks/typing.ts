import { z } from 'zod';
import { metric, num, pct } from '../scoring/performance';
import { defineProcedure } from './define';

const PASSAGES = [
  'Precision instruments are built slowly. Each part is measured twice, adjusted once, and then left alone. The result is not perfect, but it is known: every error has a size, and every size has a reason.',
  'A good map leaves things out. It keeps the rivers, the ridges and the roads, and it forgets the colour of the doors. What remains is less than the world, and far more useful than a copy of it.',
  'When the wind turned, the pilots changed course without a word. They had rehearsed the moment many times on quiet days, so that on a loud day the decision would already be made.',
];

export const typing = defineProcedure({
  id: 'typing',
  domain: 'attention',
  group: 'performance',
  title: 'Typing',
  subtitle: 'Copy the passage for sixty seconds.',
  construct: 'Transcription speed and accuracy. A skill metric, not part of any intelligence estimate.',
  instructions: ['Type the passage exactly as shown, including punctuation.', 'The timer starts with your first keystroke and stops after 60 seconds.', 'Corrections are allowed.'],
  minutes: 2,
  input: 'keyboard-preferred',
  result: z.object({ typed: z.string().max(5000), elapsedMs: z.number().min(0), backspaces: z.number().int().min(0) }),
  build(rng) {
    return { text: rng.pick(PASSAGES), durationMs: 60_000 };
  },
  score(config: { text: string; durationMs: number }, result) {
    const minutes = Math.max(result.elapsedMs, 1000) / 60_000;
    let correctChars = 0;
    for (let i = 0; i < result.typed.length; i++) if (result.typed[i] === config.text[i]) correctChars++;
    const errors = result.typed.length - correctChars;
    const gross = result.typed.length / 5 / minutes;
    const net = Math.max(0, gross - errors / minutes);
    const acc = result.typed.length ? correctChars / result.typed.length : NaN;
    return {
      metrics: [
        metric('net', 'Net speed', net, `${num(net, 0)} WPM`, { note: 'Large typing study mean: 51.6 WPM, SD 20.2 (Dhakal et al., 2018)' }),
        metric('gross', 'Gross speed', gross, `${num(gross, 0)} WPM`),
        metric('accuracy', 'Accuracy', acc, pct(acc, 1)),
        metric('corrections', 'Corrections', result.backspaces, String(result.backspaces)),
      ],
    };
  },
});
