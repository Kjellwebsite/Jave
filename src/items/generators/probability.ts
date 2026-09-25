/**
 * Probabilistic reasoning. Short scenarios with five options. Answers are exact
 * rationals (bigint); distractors encode named reasoning errors and must sit at
 * least 2 percentage points from the key and from each other.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export interface ProbabilityContent {
  scenario: string;
  question: string;
  options: string[];
}

/* Exact rationals. */
interface Q {
  n: bigint;
  d: bigint;
}

const bgcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const q = (n: number | bigint, d: number | bigint = 1): Q => {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error('probability: division by zero');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = bgcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
};
const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Q, b: Q) => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
const ONE = q(1);
const pct = (p: number) => q(p, 100);
const cmp = (a: Q, b: Q) => {
  const x = a.n * b.d - b.n * a.d;
  return x > 0n ? 1 : x < 0n ? -1 : 0;
};
const prod = (xs: Q[]) => xs.reduce(mul, ONE);

/** Tenths of a percent, rounded half up (non-negative inputs). */
const tenths = (x: Q) => Number((2000n * x.n + x.d) / (2n * x.d));
const fmtTenths = (t: number) => `${Math.floor(t / 10)}.${t % 10}%`;
export const formatPercent = (x: Q) => fmtTenths(tenths(x));

/** Points with at most one decimal (inputs are multiples of 0.5 or whole). */
const fmtPoints = (x: Q) => {
  const v = Number(x.n) / Number(x.d);
  const s = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return `${v < 0 ? '−' : ''}${s}`;
};

interface Built {
  scenario: string;
  question: string;
  options: string[];
  key: number;
  type: string;
  features: Record<string, number | string | boolean>;
  explanation: string;
}

/** Key plus the first four distractors that keep a 2-point gap; null if fewer than four fit. */
function percentOptions(rng: Rng, key: Q, distractors: Q[]): { options: string[]; key: number } | null {
  if (key.n <= 0n || key.n >= key.d) return null;
  const chosen = [tenths(key)];
  for (const d of distractors) {
    if (d.n < 0n || d.n > d.d) continue;
    const t = tenths(d);
    if (chosen.every((c) => Math.abs(c - t) >= 20)) chosen.push(t);
    if (chosen.length === 5) break;
  }
  if (chosen.length < 5) return null;
  const order = rng.shuffle([0, 1, 2, 3, 4]);
  return { options: order.map((i) => fmtTenths(chosen[i])), key: order.indexOf(0) };
}

function statementOptions(rng: Rng, statements: string[], correct: number): { options: string[]; key: number } {
  const order = rng.shuffle(statements.map((_, i) => i));
  return { options: order.map((i) => statements[i]), key: order.indexOf(correct) };
}

/* ------------------------------------------------------------------ */

const DRAW_CONTEXTS = [
  { holder: 'A bag holds', noun: 'marble', plural: 'marbles', colors: ['red', 'blue', 'green'], pick: 'One marble is drawn at random.' },
  {
    holder: 'A packet holds',
    noun: 'seed',
    plural: 'seeds',
    colors: ['red-flowering', 'white-flowering', 'yellow-flowering'],
    pick: 'One seed is picked at random.',
  },
  { holder: 'A crate holds', noun: 'bolt', plural: 'bolts', colors: ['steel', 'brass', 'copper'], pick: 'One bolt is taken at random.' },
];

const list3 = (xs: string[]) => `${xs[0]}, ${xs[1]} and ${xs[2]}`;

function level1(rng: Rng): Built | null {
  const ctx = rng.pick(DRAW_CONTEXTS);
  const c = rng.sample([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3);
  const N = c[0] + c[1] + c[2];
  const scenario = `${ctx.holder} ${list3(c.map((x, i) => `${x} ${ctx.colors[i]}`))} ${ctx.plural}. ${ctx.pick}`;
  const [i, j, k] = rng.shuffle([0, 1, 2]);
  const two = rng.chance(0.4);
  let key: Q;
  let distractors: Q[];
  let question: string;
  if (!two) {
    key = q(c[i], N);
    question = `What is the probability that the ${ctx.noun} is ${ctx.colors[i]}?`;
    distractors = [q(c[i], N - c[i]), q(1, 3), q(c[j], N), q(N - c[i], N), q(c[k], N)];
  } else {
    key = q(c[i] + c[j], N);
    question = `What is the probability that the ${ctx.noun} is ${ctx.colors[i]} or ${ctx.colors[j]}?`;
    distractors = [q(c[i] + c[j], c[k]), q(2, 3), mul(q(c[i], N), q(c[j], N)), q(c[k], N), q(c[i], N), q(c[j], N)];
  }
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario,
    question,
    ...o,
    type: 'single event',
    features: { counts: c.join(','), targets: two ? `${i},${j}` : `${i}` },
    explanation: `Favourable ${two ? c[i] + c[j] : c[i]} out of ${N}: ${formatPercent(key)}.`,
  };
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

const listPct = (ps: number[]) => {
  const xs = ps.map((p) => `${p}%`);
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
};

const FAIL_CONTEXTS = [
  {
    many: (n: number, p: number) => `Each of ${WORDS[n]} weather stations loses its signal on a given day with probability ${p}%, independently of the others.`,
    diff: (ps: number[]) =>
      `${cap(WORDS[ps.length])} weather stations lose their signal on a given day with probabilities ${listPct(ps)}, independently of each other.`,
    atLeast: 'What is the probability that at least one station loses its signal that day?',
    none: 'What is the probability that no station loses its signal that day?',
  },
  {
    many: (n: number, p: number) => `A machine makes a faulty part with probability ${p}%, independently for each part. ${cap(WORDS[n])} parts are checked.`,
    diff: (ps: number[]) =>
      `A product passes through ${WORDS[ps.length]} machines. They introduce a fault with probabilities ${listPct(ps)}, independently of each other.`,
    atLeast: 'What is the probability that at least one fault occurs?',
    none: 'What is the probability that no fault occurs?',
  },
  {
    many: (n: number, p: number) => `Each seed fails to sprout with probability ${p}%, independently of the other seeds. ${cap(WORDS[n])} seeds are sown.`,
    diff: (ps: number[]) =>
      `${cap(WORDS[ps.length])} seeds of different varieties are sown. They fail to sprout with probabilities ${listPct(ps)}, independently of each other.`,
    atLeast: 'What is the probability that at least one seed fails to sprout?',
    none: 'What is the probability that every seed sprouts?',
  },
];

function level2(rng: Rng): Built | null {
  const ctx = rng.pick(FAIL_CONTEXTS);
  const P = [5, 10, 15, 20, 25, 30, 35, 40];
  const variant = rng.pick(['same', 'same', 'diff', 'none'] as const);
  let ps: number[];
  let scenario: string;
  if (variant === 'diff') {
    ps = rng.sample(P, rng.int(2, 3));
    scenario = ctx.diff(ps);
  } else {
    const n = rng.int(2, 4);
    const p = rng.pick(P);
    ps = Array.from({ length: n }, () => p);
    scenario = ctx.many(n, p);
  }
  const fails = ps.map(pct);
  const none = prod(fails.map((f) => sub(ONE, f)));
  const all = prod(fails);
  const sum = fails.reduce(add, q(0));
  const atLeast = sub(ONE, none);
  let key: Q;
  let distractors: Q[];
  if (variant === 'none') {
    key = none;
    distractors = [sub(ONE, sum), atLeast, sub(ONE, all), all, sub(ONE, fails[0])];
  } else {
    key = atLeast;
    distractors = [sum, all, none, fails.reduce((m, f) => (cmp(f, m) > 0 ? f : m)), sub(ONE, all)];
  }
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario,
    question: variant === 'none' ? ctx.none : ctx.atLeast,
    ...o,
    type: 'complement',
    features: { variant, ps: ps.join(',') },
    explanation: `P(none) is the product of the individual complements, ${formatPercent(none)}. ${variant === 'none' ? '' : `At least one: 1 − P(none) = ${formatPercent(key)}.`}`.trim(),
  };
}

const FREQ_CONTEXTS = [
  (N: number, nA: number, dA: number, dB: number) => ({
    scenario: `A factory made ${N} parts last week: ${nA} on machine A and ${N - nA} on machine B. ${dA} of the machine A parts and ${dB} of the machine B parts were defective.`,
    question: 'One of the defective parts is picked at random. What is the probability that it came from machine A?',
  }),
  (N: number, nA: number, dA: number, dB: number) => ({
    scenario: `A weather station recorded ${N} mornings: ${nA} were cloudy and ${N - nA} were clear. Rain fell later on ${dA} of the cloudy days and on ${dB} of the clear days.`,
    question: 'One of the rainy days is picked at random. What is the probability that its morning was cloudy?',
  }),
  (N: number, nA: number, dA: number, dB: number) => ({
    scenario: `A nursery sowed ${N} seeds: ${nA} treated and ${N - nA} untreated. ${dA} of the treated seeds and ${dB} of the untreated seeds sprouted.`,
    question: 'One of the sprouted seeds is picked at random. What is the probability that it was treated?',
  }),
];

function level3(rng: Rng): Built | null {
  const N = rng.pick([200, 250, 300, 400, 500, 600, 800]);
  const nA = Math.round((N * rng.int(20, 60)) / 1000) * 10;
  const nB = N - nA;
  if (nA < 20 || nB < 20) return null;
  const dA = rng.int(Math.ceil(nA * 0.1), Math.floor(nA * 0.6));
  const dB = rng.int(Math.ceil(nB * 0.05), Math.floor(nB * 0.5));
  const text = rng.pick(FREQ_CONTEXTS)(N, nA, dA, dB);
  const key = q(dA, dA + dB);
  const distractors = [q(dA, nA), q(dA, N), q(nA, N), q(dA + dB, N), q(dB, dA + dB)];
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    ...text,
    ...o,
    type: 'conditional frequencies',
    features: { N, nA, dA, dB },
    explanation: `${dA} of the ${dA + dB} cases in question: ${formatPercent(key)}.`,
  };
}

interface Lottery {
  p: number[];
  x: number[];
}

const PROB_SPLITS = [
  [50, 30, 20],
  [60, 30, 10],
  [40, 40, 20],
  [70, 20, 10],
  [50, 40, 10],
  [40, 30, 30],
  [20, 30, 50],
  [10, 30, 60],
  [60, 20, 20],
];

const ev = (l: Lottery) => l.p.reduce((t, p, i) => add(t, mul(pct(p), q(l.x[i]))), q(0));
const naive = (l: Lottery) => q(l.x[0] + l.x[1] + l.x[2], 3);

function randomLottery(rng: Rng): Lottery {
  const p = rng.shuffle(rng.pick(PROB_SPLITS));
  const a = [rng.int(-6, 24), rng.int(-6, 24)];
  let third = rng.int(-6, 24);
  while ((a[0] + a[1] + third) % 3 !== 0) third++;
  const x = [...a, third].map((v) => v * 5);
  return { p, x };
}

const describeLottery = (l: Lottery) =>
  l.p
    .map((p, i) => {
      const x = l.x[i];
      return `${p}% chance to ${x > 0 ? `win ${x} points` : x < 0 ? `lose ${-x} points` : 'win nothing'}`;
    })
    .join(', ');

function level4(rng: Rng): Built | null {
  const A = randomLottery(rng);
  const B = randomLottery(rng);
  if (rng.chance(0.2)) {
    // Aim for equal expected values by solving for B's last payoff.
    const need = sub(ev(A), add(mul(pct(B.p[0]), q(B.x[0])), mul(pct(B.p[1]), q(B.x[1]))));
    const x2 = div(need, pct(B.p[2]));
    if (x2.d !== 1n || x2.n % 5n !== 0n) return null;
    B.x[2] = Number(x2.n);
    if ((B.x[0] + B.x[1] + B.x[2]) % 15 !== 0 || Math.abs(B.x[2]) > 150) return null;
  }
  if (new Set(A.x).size < 3 || new Set(B.x).size < 3) return null;
  const evA = ev(A);
  const evB = ev(B);
  const nA = naive(A);
  const nB = naive(B);
  const c = cmp(evA, evB);
  const gap = Math.abs(Number(sub(evA, evB).n) / Number(sub(evA, evB).d));
  if (c !== 0 && gap < 1) return null;
  if (cmp(nA, nB) === c) return null;
  const far = (a: Q, b: Q) => Math.abs(Number(sub(a, b).n) / Number(sub(a, b).d)) >= 1;
  if (!far(nA, evA) || !far(nA, evB) || !far(nB, evA) || !far(nB, evB)) return null;
  const statements = [
    'Option A has the higher expected value.',
    'Option B has the higher expected value.',
    'Both options have the same expected value.',
    `The expected value of Option A is ${fmtPoints(nA)} points.`,
    `The expected value of Option B is ${fmtPoints(nB)} points.`,
  ];
  const correct = c > 0 ? 0 : c < 0 ? 1 : 2;
  const o = statementOptions(rng, statements, correct);
  return {
    scenario: `You may play one of two games once. Option A: ${describeLottery(A)}. Option B: ${describeLottery(B)}.`,
    question: 'Which statement is correct?',
    ...o,
    type: 'expected value',
    features: { A: A.p.map((p, i) => `${p}:${A.x[i]}`).join(','), B: B.p.map((p, i) => `${p}:${B.x[i]}`).join(',') },
    explanation: `Expected values: A ${fmtPoints(evA)}, B ${fmtPoints(evB)} points. Averaging the payoffs ignores their probabilities.`,
  };
}

const SAMPLE_CONTEXTS = [
  { intro: (N: number, g: number) => `A box holds ${N} light bulbs, ${g} of which are faulty.`, draw: 'bulbs are taken at random without replacement', kind: 'faulty' },
  { intro: (N: number, g: number) => `A tray holds ${N} seeds, ${g} of which are from the red variety.`, draw: 'seeds are picked at random without replacement', kind: 'red' },
  { intro: (N: number, g: number) => `An urn holds ${g} white and ${N - g} black balls.`, draw: 'balls are drawn at random without replacement', kind: 'white' },
];

function level5(rng: Rng): Built | null {
  const ctx = rng.pick(SAMPLE_CONTEXTS);
  const N = rng.int(8, 20);
  const g = rng.int(3, N - 3);
  const variant = rng.pick(['both', 'both', 'one', 'three'] as const);
  const draws = variant === 'three' ? 3 : 2;
  const gN = q(g, N);
  let key: Q;
  let distractors: Q[];
  let question: string;
  if (variant === 'both') {
    key = q(g * (g - 1), N * (N - 1));
    question = `What is the probability that both are ${ctx.kind}?`;
    distractors = [mul(gN, gN), gN, q(g - 1, N - 1), add(gN, q(g - 1, N - 1)), q(g * (g - 1), N * N)];
  } else if (variant === 'one') {
    key = q(2 * g * (N - g), N * (N - 1));
    question = `What is the probability that exactly one of them is ${ctx.kind}?`;
    distractors = [q(g * (N - g), N * (N - 1)), q(2 * g * (N - g), N * N), q(g * (N - g), N * N), gN, q(N - g, N)];
  } else {
    key = q(g * (g - 1) * (g - 2), N * (N - 1) * (N - 2));
    question = `What is the probability that all three are ${ctx.kind}?`;
    distractors = [mul(gN, mul(gN, gN)), gN, q(g * (g - 1), N * (N - 1)), q(g - 2, N - 2), q(3 * g, N)];
  }
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario: `${ctx.intro(N, g)} ${cap(WORDS[draws])} ${ctx.draw}.`,
    question,
    ...o,
    type: 'without replacement',
    features: { variant, N, g },
    explanation: `Each draw changes what remains in the container: ${formatPercent(key)}.`,
  };
}

const BAYES_CONTEXTS = [
  {
    one: (p: number, h: number, f: number) =>
      `In a factory, ${p}% of parts are faulty. A scanner flags ${h}% of faulty parts and also flags ${f}% of parts that are fine. A part is flagged.`,
    two: (p: number, h1: number, f1: number, h2: number, f2: number) =>
      `In a factory, ${p}% of parts are faulty. Scanner A flags ${h1}% of faulty parts and ${f1}% of good parts. Scanner B flags ${h2}% of faulty parts and ${f2}% of good parts. Given whether a part is faulty, the two scanners flag independently. A part is flagged by both scanners.`,
    question: 'What is the probability that the part is faulty?',
  },
  {
    one: (p: number, h: number, f: number) =>
      `At a weather station, frost occurs on ${p}% of nights. A frost sensor raises an alert on ${h}% of frost nights and on ${f}% of frost-free nights. Tonight the sensor raises an alert.`,
    two: (p: number, h1: number, f1: number, h2: number, f2: number) =>
      `At a weather station, frost occurs on ${p}% of nights. Sensor A alerts on ${h1}% of frost nights and ${f1}% of frost-free nights. Sensor B alerts on ${h2}% of frost nights and ${f2}% of frost-free nights. Given whether there is frost, the two sensors alert independently. Tonight both sensors alert.`,
    question: 'What is the probability of frost tonight?',
  },
  {
    one: (p: number, h: number, f: number) =>
      `In a seed batch, ${p}% of seeds carry a blight. A lab test is positive for ${h}% of blighted seeds and for ${f}% of healthy seeds. A seed tests positive.`,
    two: (p: number, h1: number, f1: number, h2: number, f2: number) =>
      `In a seed batch, ${p}% of seeds carry a blight. Test A is positive for ${h1}% of blighted seeds and ${f1}% of healthy seeds. Test B is positive for ${h2}% of blighted seeds and ${f2}% of healthy seeds. Given whether a seed is blighted, the two tests err independently. A seed is positive on both tests.`,
    question: 'What is the probability that the seed carries the blight?',
  },
];

const posterior = (p: Q, h: Q, f: Q) => div(mul(p, h), add(mul(p, h), mul(sub(ONE, p), f)));

function level6(rng: Rng): Built | null {
  const ctx = rng.pick(BAYES_CONTEXTS);
  const p = rng.pick([1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30]);
  const h = rng.pick([70, 75, 80, 85, 90, 95, 98]);
  const f = rng.pick([2, 3, 5, 8, 10, 12, 15, 20]);
  const [P, H, F] = [pct(p), pct(h), pct(f)];
  const key = posterior(P, H, F);
  const distractors = [H, sub(ONE, F), P, mul(P, H), add(mul(P, H), mul(sub(ONE, P), F)), sub(H, F)];
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario: ctx.one(p, h, f),
    question: ctx.question,
    ...o,
    type: 'bayes',
    features: { p, h, f },
    explanation: `True alerts ${p}% × ${h}% against false alerts ${100 - p}% × ${f}%: ${formatPercent(key)}. The hit rate alone ignores the base rate.`,
  };
}

const SIMPSON_CONTEXTS = [
  {
    intro: 'A factory tested two protective coatings, P and Q, on small and large parts.',
    names: ['Coating P', 'Coating Q'],
    groups: ['small parts', 'large parts'],
    success: 'passed a stress test',
  },
  {
    intro: 'A nursery tested two fertilisers, P and Q, on seed trays in a warm and a cool greenhouse.',
    names: ['Fertiliser P', 'Fertiliser Q'],
    groups: ['trays in the warm greenhouse', 'trays in the cool greenhouse'],
    success: 'produced healthy seedlings',
  },
  {
    intro: 'A weather service tried two repair methods, P and Q, on indoor and outdoor sensors.',
    names: ['Method P', 'Method Q'],
    groups: ['indoor sensors', 'outdoor sensors'],
    success: 'still worked a year later',
  },
];

interface Arm {
  n: [number, number];
  s: [number, number];
}

function level7(rng: Rng): Built | null {
  const ctx = rng.pick(SIMPSON_CONTEXTS);
  const paradox = rng.chance(0.7);
  // Group 0 is the easy group. W has the higher rate in both groups.
  const lRate: [number, number] = [rng.int(12, 18) * 5, rng.int(4, 11) * 5];
  const wRate: [number, number] = [lRate[0] + rng.int(1, 3) * 5, lRate[1] + rng.int(1, 3) * 5];
  if (wRate[0] > 95) return null;
  const small = () => rng.int(1, 5) * 20;
  const large = () => rng.int(8, 20) * 20;
  const W: Arm = { n: paradox ? [small(), large()] : [rng.int(3, 12) * 20, rng.int(3, 12) * 20], s: [0, 0] };
  const L: Arm = { n: paradox ? [large(), small()] : [rng.int(3, 12) * 20, rng.int(3, 12) * 20], s: [0, 0] };
  for (const g of [0, 1] as const) {
    W.s[g] = (W.n[g] * wRate[g]) / 100;
    L.s[g] = (L.n[g] * lRate[g]) / 100;
  }
  const overall = (a: Arm) => q(a.s[0] + a.s[1], a.n[0] + a.n[1]);
  const oW = overall(W);
  const oL = overall(L);
  const isParadox = cmp(oL, oW) > 0;
  if (isParadox !== paradox) return null;
  if (Math.abs(tenths(oW) - tenths(oL)) < 20) return null;
  const swapNames = rng.chance(0.5);
  const wName = ctx.names[swapNames ? 1 : 0];
  const lName = ctx.names[swapNames ? 0 : 1];
  const gOrder = rng.chance(0.5) ? [0, 1] : [1, 0];
  const describe = (name: string, a: Arm) =>
    `${name}: ${gOrder.map((g) => `${a.s[g]} of ${a.n[g]} ${ctx.groups[g]}`).join(' and ')} ${ctx.success}.`;
  const arms = swapNames ? [describe(lName, L), describe(wName, W)] : [describe(wName, W), describe(lName, L)];
  const statements = [
    `${wName} has the higher success rate in each group and also overall.`,
    `${wName} has the higher success rate in each group, but ${lName} has the higher rate overall.`,
    `${lName} has the higher success rate in each group and also overall.`,
    `${lName} has the higher success rate in each group, but ${wName} has the higher rate overall.`,
    'Both have the same overall success rate.',
  ];
  const o = statementOptions(rng, statements, paradox ? 1 : 0);
  return {
    scenario: `${ctx.intro} ${arms.join(' ')}`,
    question: 'Which statement is correct?',
    ...o,
    type: 'simpson',
    features: {
      paradox,
      winner: wName,
      w: `${W.s[0]}/${W.n[0]},${W.s[1]}/${W.n[1]}`,
      l: `${L.s[0]}/${L.n[0]},${L.s[1]}/${L.n[1]}`,
    },
    explanation: `Group rates favour ${wName}. Overall: ${wName} ${formatPercent(oW)}, ${lName} ${formatPercent(oL)}. The overall rate weights each group by how many cases it received, not the plain average of the group rates.`,
  };
}

function level8(rng: Rng): Built | null {
  const ctx = rng.pick(BAYES_CONTEXTS);
  const p = rng.pick([1, 2, 3, 5, 8, 10, 15, 20]);
  const [h1, h2] = [rng.pick([70, 75, 80, 85, 90, 95]), rng.pick([60, 70, 75, 80, 85, 90])];
  const [f1, f2] = [rng.pick([5, 10, 15, 20]), rng.pick([10, 15, 20, 25, 30])];
  const [P, H1, F1, H2, F2] = [pct(p), pct(h1), pct(f1), pct(h2), pct(f2)];
  const key = posterior(P, mul(H1, H2), mul(F1, F2));
  const post1 = posterior(P, H1, F1);
  const post2 = posterior(P, H2, F2);
  const distractors = [post1, mul(H1, H2), sub(ONE, mul(F1, F2)), post2, add(post1, post2), P, H1];
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario: ctx.two(p, h1, f1, h2, f2),
    question: ctx.question,
    ...o,
    type: 'sequential bayes',
    features: { p, h1, f1, h2, f2 },
    explanation: `After the first result: ${formatPercent(post1)}. Updating that on the second: ${formatPercent(key)}.`,
  };
}

const DEP_CONTEXTS = [
  { intro: (r: number, b: number) => `An urn holds ${r} red and ${b} blue balls.`, noun: 'ball', plural: 'balls', a: 'red', b: 'blue' },
  { intro: (r: number, b: number) => `A jar holds ${r} yellow and ${b} green seeds.`, noun: 'seed', plural: 'seeds', a: 'yellow', b: 'green' },
  { intro: (r: number, b: number) => `A bin holds ${r} brass and ${b} steel bolts.`, noun: 'bolt', plural: 'bolts', a: 'brass', b: 'steel' },
];

function level9(rng: Rng): Built | null {
  const ctx = rng.pick(DEP_CONTEXTS);
  const r = rng.int(3, 10);
  const b = rng.int(3, 10);
  if (r === b) return null;
  const N = r + b;
  const variant = rng.pick(['atLeastOne', 'same', 'second'] as const);
  const draw = `Two ${ctx.plural} are drawn one after the other at random, without replacement.`;
  let key: Q;
  let distractors: Q[];
  let question: string;
  if (variant === 'atLeastOne') {
    key = q(r * (r - 1), N * (N - 1) - b * (b - 1));
    question = `At least one of the two is ${ctx.a}. What is the probability that both are ${ctx.a}?`;
    distractors = [q(r - 1, N - 1), q(r * (r - 1), N * (N - 1)), q(r * r, N * N - b * b), q(r, N), q(1, 2)];
  } else if (variant === 'same') {
    key = q(r * (r - 1), r * (r - 1) + b * (b - 1));
    question = `The two ${ctx.plural} have the same colour. What is the probability that both are ${ctx.a}?`;
    distractors = [q(r * r, r * r + b * b), q(r, N), q(r * (r - 1), N * (N - 1)), q(r - 1, N - 1), q(1, 2)];
  } else {
    key = q(r - 1, N - 1);
    question = `The second ${ctx.noun} is ${ctx.a}. What is the probability that the first was also ${ctx.a}?`;
    distractors = [q(r, N), q(r * (r - 1), N * (N - 1)), q(r * r, N * N), q(r, N - 1), q(r - 1, N)];
  }
  const o = percentOptions(rng, key, distractors);
  if (!o) return null;
  return {
    scenario: `${ctx.intro(r, b)} ${draw}`,
    question,
    ...o,
    type: 'dependent conditional',
    features: { variant, r, b },
    explanation: `Restrict to the outcomes that satisfy the condition, then count the favourable ones: ${formatPercent(key)}.`,
  };
}

const LEVEL_BUILDERS: Record<number, (rng: Rng) => Built | null> = {
  1: level1,
  2: level2,
  3: level3,
  4: level4,
  5: level5,
  6: level6,
  7: level7,
  8: level8,
  9: level9,
};

export function generateProbability(level: number, rng: Rng): Built {
  const build = LEVEL_BUILDERS[level];
  if (!build) throw new Error(`probability: unknown level ${level}`);
  for (let attempt = 0; attempt < 400; attempt++) {
    const b = build(rng);
    if (b && new Set(b.options).size === 5) return b;
  }
  throw new Error(`probability: could not generate level ${level}`);
}

export const PROBABILITY_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.2, b: -1.4, c: 0.2, timeLimitMs: 60_000 },
  { level: 2, a: 1.25, b: -0.6, c: 0.2, timeLimitMs: 75_000 },
  { level: 3, a: 1.3, b: 0.0, c: 0.2, timeLimitMs: 90_000 },
  { level: 4, a: 1.35, b: 0.6, c: 0.2, timeLimitMs: 105_000 },
  { level: 5, a: 1.4, b: 1.1, c: 0.2, timeLimitMs: 105_000 },
  { level: 6, a: 1.45, b: 1.7, c: 0.2, timeLimitMs: 120_000 },
  { level: 7, a: 1.5, b: 2.3, c: 0.2, timeLimitMs: 135_000 },
  { level: 8, a: 1.55, b: 2.9, c: 0.2, timeLimitMs: 150_000 },
  { level: 9, a: 1.6, b: 3.4, c: 0.2, timeLimitMs: 150_000 },
];

export const probability = generatorParadigm<ProbabilityContent, number>({
  id: 'probability',
  version: 1,
  domain: 'quant',
  group: 'core',
  facet: 'probabilistic',
  title: 'Probabilistic reasoning',
  subtitle: 'Read the situation. Choose the correct probability.',
  construct: 'Reasoning under uncertainty: combining, conditioning and updating probabilities.',
  instructions: [
    'Each problem describes a chance situation in a few sentences.',
    'Choose the one correct answer out of five.',
    'Percentages are rounded to one decimal place.',
    'You may use paper for working.',
  ],
  minutes: 7,
  minRtMs: 4000,
  levels: PROBABILITY_LEVELS,
  practiceLevels: [1, 3],
  generate(level, rng) {
    const b = generateProbability(level, rng);
    return {
      content: { scenario: b.scenario, question: b.question, options: b.options },
      key: b.key,
      response: { kind: 'choice', options: 5 },
      features: { type: b.type, ...b.features },
      explanation: b.explanation,
    };
  },
});
