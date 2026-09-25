import { h, s, sleep } from '../core/dom';
import { pick, sample, shuffle } from '../core/rng';
import type { TaskDef } from '../core/types';
import { choose, flash, interlude } from '../core/ui';

/** Six binary features give 64 distinct creatures. */
const FEATURES = ['color', 'eyes', 'antenna', 'body', 'spots', 'legs'] as const;
type Feature = (typeof FEATURES)[number];
type Alien = Record<Feature, 0 | 1>;

const DESCRIBE: Record<Feature, [string, string]> = {
  color: ['are blue', 'are orange'],
  eyes: ['have one eye', 'have two eyes'],
  antenna: ['have no antennae', 'have antennae'],
  body: ['have a round body', 'have a square body'],
  spots: ['have no spots', 'have spots'],
  legs: ['have two legs', 'have four legs'],
};

const ALL: Alien[] = [];
for (let i = 0; i < 64; i++) {
  const a = {} as Alien;
  FEATURES.forEach((f, bit) => (a[f] = ((i >> bit) & 1) as 0 | 1));
  ALL.push(a);
}

interface Round {
  name: string;
  test: (a: Alien) => boolean;
  explain: string;
}

function makeRounds(): Round[] {
  const [f1, f2, f3, f4, f5] = sample(FEATURES, 5);
  const v = () => pick([0, 1] as const);
  const a = v();
  const [b1, b2, c1, c2] = [v(), v(), v(), v()];
  return [
    { name: 'Zorb', test: (x) => x[f1] === a, explain: `Zorbs ${DESCRIBE[f1][a]}.` },
    {
      name: 'Quill',
      test: (x) => x[f2] === b1 && x[f3] === b2,
      explain: `Quills ${DESCRIBE[f2][b1]} and ${DESCRIBE[f3][b2]}.`,
    },
    {
      name: 'Blip',
      test: (x) => x[f4] === c1 || x[f5] === c2,
      explain: `Blips ${DESCRIBE[f4][c1]}, or ${DESCRIBE[f5][c2]}, or both.`,
    },
  ];
}

const LEARN = 14;
const TEST = 6;

function drawAlien(x: Alien): SVGElement {
  const fill = x.color ? '#E8912D' : '#3A86D9';
  const parts: SVGElement[] = [];
  const legXs = x.legs ? [32, 44, 56, 68] : [40, 60];
  for (const lx of legXs) parts.push(s('line', { x1: lx, y1: 80, x2: lx + (lx < 50 ? -3 : 3), y2: 97, class: 'al-limb' }));
  if (x.antenna) {
    parts.push(s('line', { x1: 42, y1: 38, x2: 34, y2: 14, class: 'al-limb' }));
    parts.push(s('line', { x1: 58, y1: 38, x2: 66, y2: 14, class: 'al-limb' }));
    parts.push(s('circle', { cx: 34, cy: 13, r: 4, fill }));
    parts.push(s('circle', { cx: 66, cy: 13, r: 4, fill }));
  }
  parts.push(
    x.body
      ? s('rect', { x: 23, y: 33, width: 54, height: 52, rx: 9, fill, class: 'al-body' })
      : s('circle', { cx: 50, cy: 60, r: 27, fill, class: 'al-body' }),
  );
  if (x.spots) {
    for (const [sx, sy] of [[36, 72], [50, 77], [64, 71]]) parts.push(s('circle', { cx: sx, cy: sy, r: 3.6, class: 'al-spot' }));
  }
  const eyes = x.eyes ? [[41, 53, 7], [59, 53, 7]] : [[50, 52, 9.5]];
  for (const [ex, ey, er] of eyes) {
    parts.push(s('circle', { cx: ex, cy: ey, r: er, fill: '#fff' }));
    parts.push(s('circle', { cx: ex + 1.2, cy: ey + 1, r: er * 0.45, fill: '#111' }));
  }
  parts.push(s('path', { d: 'M43 67 Q50 72 57 67', class: 'al-mouth' }));
  return s('svg', { viewBox: '0 0 100 104', class: 'al-svg', 'aria-hidden': 'true' }, ...parts);
}

export const aliens: TaskDef = {
  id: 'aliens',
  domain: 'learning',
  name: 'Alien Categories',
  tagline: 'Learn the unwritten rule from examples.',
  minutes: 3,
  measures: ['Rule Learning', 'Concept Formation', 'Generalization', 'Adaptation to Feedback', 'Learning Rate'],
  instructions: [
    'You will meet three alien species, one after another.',
    'For each creature, decide if it belongs to the species. You get feedback while learning.',
    'After the learning phase you sort new creatures you have not seen, without feedback.',
    'Keys: F / ← for "Yes", J / → for "No". Or tap the buttons.',
  ],
  async run(ctx) {
    const rounds = makeRounds();
    const trials: { round: number; phase: 'learn' | 'test'; member: boolean; said: boolean | null; correct: boolean; rt: number }[] = [];
    const total = rounds.length * (LEARN + TEST);
    let step = 0;

    for (let r = 0; r < rounds.length; r++) {
      const round = rounds[r];
      const members = shuffle(ALL.filter(round.test));
      const others = shuffle(ALL.filter((x) => !round.test(x)));
      const learn = shuffle([...members.slice(0, LEARN / 2), ...others.slice(0, LEARN / 2)]);
      const test = shuffle([...members.slice(LEARN / 2, LEARN / 2 + TEST / 2), ...others.slice(LEARN / 2, LEARN / 2 + TEST / 2)]);

      await interlude(
        ctx.stage,
        `Species ${r + 1} of ${rounds.length} · ${round.name}s`,
        `Learn which creatures are ${round.name}s. You'll get feedback on the first ${LEARN}, then sort ${TEST} new ones on your own.`,
        ctx.signal,
        'Start',
      );

      const phases: ['learn' | 'test', Alien[]][] = [['learn', learn], ['test', test]];
      for (const [phase, list] of phases) {
        if (phase === 'test') {
          await interlude(ctx.stage, 'Now on your own', `${TEST} creatures you haven't seen. No feedback this time.`, ctx.signal, 'Continue');
        }
        for (const alien of list) {
          ctx.progress(step++, total);
          const member = round.test(alien);
          const tag = h('div', { class: 'al-phase' }, phase === 'learn' ? `Learning · ${round.name}` : `Test · ${round.name}`);
          const fig = h('div', { class: 'al-figure' }, drawAlien(alien));
          const fb = h('div', { class: 'al-feedback' });
          ctx.stage.replaceChildren(tag, fig, h('p', { class: 'prompt' }, `Is this a ${round.name}?`), fb);
          const res = await choose(
            ctx.stage,
            {
              options: [`Yes, a ${round.name}`, 'No'],
              layout: 'row',
              keys: [['f', 'arrowleft', '1'], ['j', 'arrowright', '2']],
            },
            ctx.signal,
          );
          const said = res.index === null ? null : res.index === 0;
          const correct = said === member;
          trials.push({ round: r, phase, member, said, correct, rt: res.rt });
          if (phase === 'learn') await flash(fb, correct, correct ? 'Correct' : member ? `That was a ${round.name}` : `Not a ${round.name}`, 800, ctx.signal);
          else await sleep(250, ctx.signal);
        }
      }
      await interlude(ctx.stage, 'Rule revealed', round.explain, ctx.signal, r < rounds.length - 1 ? 'Next species' : 'Finish');
    }
    ctx.progress(total, total);

    const acc = (list: typeof trials) => (list.length ? list.filter((t) => t.correct).length / list.length : 0);
    const learnTrials = trials.filter((t) => t.phase === 'learn');
    const testTrials = trials.filter((t) => t.phase === 'test');
    const firstHalf = learnTrials.filter((t) => learnTrials.filter((u) => u.round === t.round).indexOf(t) < LEARN / 2);
    const secondHalf = learnTrials.filter((t) => !firstHalf.includes(t));
    const afterError = learnTrials.slice(1).filter((_, i) => !learnTrials[i].correct && learnTrials[i].round === learnTrials[i + 1].round);
    const score = 0.5 * acc(learnTrials) + 0.5 * acc(testTrials);
    const gain = acc(secondHalf) - acc(firstHalf);

    return {
      score,
      scoreDisplay: `${Math.round(score * 100)}% learning score`,
      facets: [
        { facet: 'Rule Learning', display: `${Math.round(acc(learnTrials) * 100)}%`, note: 'Accuracy while learning' },
        { facet: 'Generalization', display: `${testTrials.filter((t) => t.correct).length}/${testTrials.length}`, note: 'New creatures sorted correctly' },
        { facet: 'Learning Rate', display: `${gain >= 0 ? '+' : ''}${Math.round(gain * 100)} pts`, note: 'Second half vs first half of each learning phase' },
        { facet: 'Adaptation to Feedback', display: afterError.length ? `${Math.round(acc(afterError) * 100)}%` : 'No errors', note: 'Correct right after a mistake' },
        { facet: 'Concept Formation', display: `${Math.round(acc(trials.filter((t) => t.round === 2)) * 100)}%`, note: 'Accuracy on the either/or species' },
      ],
      trials,
    };
  },
};
