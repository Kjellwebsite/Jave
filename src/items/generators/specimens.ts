/**
 * Specimen anomaly. Nine organisms share a hidden covariation rule; one breaks
 * it. Items are rejected when any rule of equal or lower complexity singles out
 * a different specimen, when a simpler rule singles out the anomaly, or when the
 * anomaly stands out on a single trait that is not part of the rule.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export interface Specimen {
  segments: 2 | 3 | 4 | 5;
  limbPairs: 1 | 2 | 3 | 4 | 5 | 6;
  symmetry: 'bilateral' | 'radial';
  marking: 'none' | 'spots' | 'stripes' | 'rings';
  antennae: 'none' | 'short' | 'long' | 'forked';
  tone: 0 | 1 | 2 | 3;
}

export interface SpecimensContent {
  specimens: Specimen[];
}

export type Trait = keyof Specimen;
type Value = Specimen[Trait];

export const TRAITS: Trait[] = ['segments', 'limbPairs', 'symmetry', 'marking', 'antennae', 'tone'];
export const TRAIT_VALUES: { [T in Trait]: readonly Specimen[T][] } = {
  segments: [2, 3, 4, 5],
  limbPairs: [1, 2, 3, 4, 5, 6],
  symmetry: ['bilateral', 'radial'],
  marking: ['none', 'spots', 'stripes', 'rings'],
  antennae: ['none', 'short', 'long', 'forked'],
  tone: [0, 1, 2, 3],
};
const NUMERIC: Trait[] = ['segments', 'limbPairs', 'tone'];
const valuesOf = (t: Trait) => TRAIT_VALUES[t] as readonly Value[];

export interface Cond {
  trait: Trait;
  value: Value;
}

export type SpecimenRule =
  | { type: 'constant'; trait: Trait; value: Value }
  /** All `when` conditions true ⇒ `then` holds. One condition is an implication, two a conjunction. */
  | { type: 'implies'; when: Cond[]; then: Cond }
  /** `b` = `a` + k. */
  | { type: 'offset'; a: Trait; b: Trait; k: number }
  /** Sum of the traits has the given parity (0 even, 1 odd). */
  | { type: 'parity'; traits: Trait[]; parity: 0 | 1 };

const get = (s: Specimen, t: Trait) => s[t] as Value;
const num = (s: Specimen, t: Trait) => s[t] as number;

export function ruleHolds(r: SpecimenRule, s: Specimen): boolean {
  switch (r.type) {
    case 'constant':
      return get(s, r.trait) === r.value;
    case 'implies':
      return !r.when.every((c) => get(s, c.trait) === c.value) || get(s, r.then.trait) === r.then.value;
    case 'offset':
      return num(s, r.b) === num(s, r.a) + r.k;
    case 'parity':
      return r.traits.reduce((sum, t) => sum + num(s, t), 0) % 2 === r.parity;
  }
}

const antecedent = (r: SpecimenRule & { type: 'implies' }, s: Specimen) => r.when.every((c) => get(s, c.trait) === c.value);

/** Complexity rank of a rule family; matches the level that introduces it. */
function familyRank(r: SpecimenRule): number {
  if (r.type === 'constant') return 1;
  if (r.type === 'implies') return r.when.length === 1 ? 3 : 5;
  if (r.type === 'offset') return 4;
  return 7;
}

const label = (c: Cond) => {
  switch (c.trait) {
    case 'segments':
      return `${c.value} segments`;
    case 'limbPairs':
      return `${c.value} limb pair${c.value === 1 ? '' : 's'}`;
    case 'symmetry':
      return `${c.value} symmetry`;
    case 'marking':
      return c.value === 'none' ? 'no markings' : String(c.value);
    case 'antennae':
      return c.value === 'none' ? 'no antennae' : `${c.value} antennae`;
    case 'tone':
      return `tone ${c.value}`;
  }
};
const traitName = (t: Trait) => (t === 'limbPairs' ? 'limb pairs' : t);

export function describeRule(r: SpecimenRule): string {
  switch (r.type) {
    case 'constant':
      return `every specimen has ${label(r)}`;
    case 'implies':
      return `every specimen with ${r.when.map(label).join(' and ')} has ${label(r.then)}`;
    case 'offset':
      return r.k === 0
        ? `${traitName(r.b)} equal ${traitName(r.a)}`
        : `${traitName(r.b)} = ${traitName(r.a)} ${r.k > 0 ? '+' : '−'} ${Math.abs(r.k)}`;
    case 'parity':
      return `${r.traits.map(traitName).join(' + ')} is ${r.parity === 0 ? 'even' : 'odd'}`;
  }
}

/* ------------------------------------------------------------------ */
/* Alternative rules for the ambiguity check                            */
/* ------------------------------------------------------------------ */

/** Minimum number of specimens (of 9) meeting an implication's antecedent before it counts as evidence. */
const MIN_SUPPORT = 4;

/** Every rule of rank ≤ maxRank that the nine specimens nearly satisfy (exactly one violator), with that violator. */
function isolatingRules(specs: Specimen[], maxRank: number): { rule: SpecimenRule; violator: number }[] {
  const out: { rule: SpecimenRule; violator: number }[] = [];
  const consider = (rule: SpecimenRule, supported = true) => {
    if (!supported) return;
    const bad = specs.map((s, i) => (ruleHolds(rule, s) ? -1 : i)).filter((i) => i >= 0);
    if (bad.length === 1) out.push({ rule, violator: bad[0] });
  };
  const conds: Cond[] = TRAITS.flatMap((trait) => valuesOf(trait).map((value) => ({ trait, value })));
  const count = (cs: Cond[]) => specs.filter((s) => cs.every((c) => get(s, c.trait) === c.value)).length;

  for (const c of conds) consider({ type: 'constant', ...c });
  if (maxRank >= 3)
    for (const w of conds) {
      if (count([w]) < MIN_SUPPORT) continue;
      for (const t of conds) if (t.trait !== w.trait) consider({ type: 'implies', when: [w], then: t });
    }
  if (maxRank >= 4)
    for (const a of NUMERIC)
      for (const b of NUMERIC) {
        if (a >= b) continue;
        for (let k = -5; k <= 5; k++) consider({ type: 'offset', a, b, k });
      }
  if (maxRank >= 5)
    for (let i = 0; i < conds.length; i++)
      for (let j = i + 1; j < conds.length; j++) {
        const w = [conds[i], conds[j]];
        if (w[0].trait === w[1].trait || count(w) < MIN_SUPPORT) continue;
        for (const t of conds) if (t.trait !== w[0].trait && t.trait !== w[1].trait) consider({ type: 'implies', when: w, then: t });
      }
  if (maxRank >= 7)
    for (const parity of [0, 1] as const) {
      for (const t of NUMERIC) consider({ type: 'parity', traits: [t], parity });
      for (let i = 0; i < NUMERIC.length; i++)
        for (let j = i + 1; j < NUMERIC.length; j++) consider({ type: 'parity', traits: [NUMERIC[i], NUMERIC[j]], parity });
    }
  return out;
}

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

export type RuleKind = 'constant' | 'implication' | 'numeric' | 'conjunction' | 'two-rules' | 'parity';

interface LevelConfig {
  level: number;
  kind: RuleKind;
  noise: number;
}

const CONFIGS: LevelConfig[] = [
  { level: 1, kind: 'constant', noise: 2 },
  { level: 2, kind: 'constant', noise: 3 },
  { level: 3, kind: 'implication', noise: 1 },
  { level: 4, kind: 'numeric', noise: 2 },
  { level: 5, kind: 'conjunction', noise: 2 },
  { level: 6, kind: 'two-rules', noise: 2 },
  { level: 7, kind: 'parity', noise: 3 },
];

const randCond = (trait: Trait, rng: Rng): Cond => ({ trait, value: rng.pick(valuesOf(trait)) });

/** Rules for a level plus the traits they use. */
function drawRules(kind: RuleKind, rng: Rng): { rules: SpecimenRule[]; used: Trait[] } {
  switch (kind) {
    case 'constant': {
      const c = randCond(rng.pick(TRAITS), rng);
      return { rules: [{ type: 'constant', ...c }], used: [c.trait] };
    }
    case 'implication': {
      const [a, b] = rng.sample(TRAITS, 2);
      return { rules: [{ type: 'implies', when: [randCond(a, rng)], then: randCond(b, rng) }], used: [a, b] };
    }
    case 'numeric':
      return { rules: [{ type: 'offset', a: 'segments', b: 'limbPairs', k: rng.int(-1, 1) }], used: ['segments', 'limbPairs'] };
    case 'conjunction': {
      const [a, b, c] = rng.sample(TRAITS, 3);
      return { rules: [{ type: 'implies', when: [randCond(a, rng), randCond(b, rng)], then: randCond(c, rng) }], used: [a, b, c] };
    }
    case 'two-rules': {
      const cat: Trait[] = ['symmetry', 'marking', 'antennae', 'tone'];
      if (rng.chance(0.5)) {
        const [a, b] = rng.sample(cat, 2);
        return {
          rules: [
            { type: 'implies', when: [randCond(a, rng)], then: randCond(b, rng) },
            { type: 'offset', a: 'segments', b: 'limbPairs', k: rng.int(-1, 1) },
          ],
          used: [a, b, 'segments', 'limbPairs'],
        };
      }
      const [a, b, c, d] = rng.sample(TRAITS, 4);
      return {
        rules: [
          { type: 'implies', when: [randCond(a, rng)], then: randCond(b, rng) },
          { type: 'implies', when: [randCond(c, rng)], then: randCond(d, rng) },
        ],
        used: [a, b, c, d],
      };
    }
    case 'parity': {
      const traits = rng.sample(NUMERIC, 2);
      return { rules: [{ type: 'parity', traits, parity: rng.pick([0, 1] as const) }], used: traits };
    }
  }
}

/** Force a specimen to satisfy (or, with `violate`, break) a rule by editing rule traits only. */
function enforce(s: Specimen, r: SpecimenRule, violate: boolean, rng: Rng): Specimen {
  const out = { ...s } as Record<Trait, Value>;
  const other = (t: Trait, v: Value) => rng.pick(valuesOf(t).filter((x) => x !== v));
  switch (r.type) {
    case 'constant':
      out[r.trait] = violate ? other(r.trait, r.value) : r.value;
      break;
    case 'implies':
      if (violate) {
        for (const c of r.when) out[c.trait] = c.value;
        out[r.then.trait] = other(r.then.trait, r.then.value);
      } else if (r.when.every((c) => out[c.trait] === c.value)) out[r.then.trait] = r.then.value;
      break;
    case 'offset': {
      const valsB = TRAIT_VALUES[r.b] as readonly number[];
      const valsA = (TRAIT_VALUES[r.a] as readonly number[]).filter((a) => valsB.includes(a + r.k));
      if (violate) {
        const choices = valsB.filter((b) => b !== (out[r.a] as number) + r.k);
        out[r.b] = rng.pick(choices) as Value;
      } else {
        if (!valsA.includes(out[r.a] as number)) out[r.a] = rng.pick(valsA) as Value;
        out[r.b] = ((out[r.a] as number) + r.k) as Value;
      }
      break;
    }
    case 'parity': {
      const sum = r.traits.reduce((acc, t) => acc + (out[t] as number), 0);
      const want = violate ? 1 - r.parity : r.parity;
      if (sum % 2 !== want) {
        const t = rng.pick(r.traits);
        const vals = TRAIT_VALUES[t] as readonly number[];
        const v = out[t] as number;
        out[t] = (vals.includes(v + 1) && (v - 1 < vals[0] || rng.chance(0.5)) ? v + 1 : v - 1) as Value;
      }
      break;
    }
  }
  return out as unknown as Specimen;
}

function randomSpecimen(rng: Rng, fixed: Partial<Record<Trait, Value>>): Specimen {
  const s = {} as Record<Trait, Value>;
  for (const t of TRAITS) s[t] = fixed[t] ?? rng.pick(valuesOf(t));
  return s as unknown as Specimen;
}

const keyOf = (s: Specimen) => TRAITS.map((t) => s[t]).join('|');

/** Checks that each rule can actually be inferred from the eight conforming specimens. */
function inferable(rules: SpecimenRule[], normals: Specimen[]): boolean {
  for (const r of rules) {
    if (r.type === 'implies') {
      const ante = normals.filter((s) => antecedent(r, s));
      if (ante.length < 3) return false;
      // The consequent must not be constant anyway, or the rule is just a constant.
      if (normals.every((s) => get(s, r.then.trait) === r.then.value)) return false;
      // Conjunction: neither condition alone may imply the consequent.
      if (r.when.length === 2)
        for (const c of r.when) {
          const alone: SpecimenRule = { type: 'implies', when: [c], then: r.then };
          if (normals.every((s) => ruleHolds(alone, s))) return false;
        }
    } else if (r.type === 'offset') {
      if (new Set(normals.map((s) => s[r.a])).size < 3) return false;
    } else if (r.type === 'parity') {
      for (const t of r.traits) if (new Set(normals.map((s) => num(s, t) % 2)).size < 2) return false;
      if (new Set(normals.map((s) => num(s, r.traits[0]) - num(s, r.traits[1]))).size < 3) return false;
    }
  }
  return true;
}

export interface SpecimensItem {
  specimens: Specimen[];
  key: number;
  rules: SpecimenRule[];
  /** Index into `rules` of the rule the anomaly breaks. */
  broken: number;
  ruleType: RuleKind;
  noiseTraits: Trait[];
  explanation: string;
}

export function generateSpecimens(level: number, rng: Rng): SpecimensItem {
  const cfg = CONFIGS.find((c) => c.level === level);
  if (!cfg) throw new Error(`specimens: unknown level ${level}`);
  // Drawn once so that rejections cannot skew which rule the anomaly breaks.
  const breakFirst = rng.chance(0.5);
  for (let attempt = 0; attempt < 3000; attempt++) {
    const { rules, used } = drawRules(cfg.kind, rng);
    const free = rng.shuffle(TRAITS.filter((t) => !used.includes(t)));
    if (free.length < cfg.noise) continue;
    const noise = free.slice(0, cfg.noise);
    const fixed: Partial<Record<Trait, Value>> = {};
    for (const t of free.slice(cfg.noise)) fixed[t] = rng.pick(valuesOf(t));

    // Eight conforming specimens. Implications get 3–4 forced antecedent cases each; a
    // conjunction also gets two cases per condition met alone, so that neither condition
    // looks like a near-rule of its own with a single exception.
    const forced: Partial<Record<Trait, Value>>[] = [];
    const meet = (cs: Cond[]) => Object.fromEntries(cs.map((c) => [c.trait, c.value])) as Partial<Record<Trait, Value>>;
    for (const r of rules) {
      if (r.type !== 'implies') continue;
      for (let n = rng.int(3, 4); n > 0; n--) forced.push(meet(r.when));
      if (r.when.length === 2)
        for (const [yes, no] of [r.when, [r.when[1], r.when[0]]])
          for (let n = 0; n < 2; n++)
            forced.push({ ...meet([yes]), [no.trait]: rng.pick(valuesOf(no.trait).filter((v) => v !== no.value)) });
    }
    if (forced.length > 8) continue;
    const normals: Specimen[] = [];
    for (let i = 0; i < 8; i++) {
      let s = { ...randomSpecimen(rng, fixed), ...(forced[i] ?? {}) } as Specimen;
      for (const r of rules) s = enforce(s, r, false, rng);
      normals.push(s);
    }
    if (!normals.every((s) => rules.every((r) => ruleHolds(r, s)))) continue;
    if (!inferable(rules, normals)) continue;

    // The anomaly: break one rule, keep the others, reuse values seen among the normals.
    const broken = rules.length > 1 && !breakFirst ? 1 : 0;
    let anomaly = randomSpecimen(rng, fixed);
    for (const t of TRAITS) if (!(t in fixed)) anomaly = { ...anomaly, [t]: get(rng.pick(normals), t) };
    anomaly = enforce(anomaly, rules[broken], true, rng);
    rules.forEach((r, i) => {
      if (i !== broken) anomaly = enforce(anomaly, r, false, rng);
    });
    if (ruleHolds(rules[broken], anomaly) || !rules.every((r, i) => i === broken || ruleHolds(r, anomaly))) continue;

    const key = rng.int(0, 8);
    const specimens = rng.shuffle(normals);
    specimens.splice(key, 0, anomaly);
    if (new Set(specimens.map(keyOf)).size !== 9) continue;

    // Only a constant rule's trait may single out the anomaly on its own.
    const exempt = rules.filter((r) => r.type === 'constant').map((r) => (r as { trait: Trait }).trait);
    const standsOut = TRAITS.some(
      (t) => !exempt.includes(t) && !specimens.some((s, i) => i !== key && get(s, t) === get(anomaly, t)),
    );
    if (standsOut) continue;

    // No competing rule may single out another specimen; no simpler rule may single out the anomaly.
    const simplest = familyRank(rules[broken]);
    const alternatives = isolatingRules(specimens, level);
    if (alternatives.some((a) => a.violator !== key)) continue;
    if (alternatives.some((a) => familyRank(a.rule) < simplest)) continue;

    const ruleText = rules.map(describeRule).join('; and ');
    return {
      specimens,
      key,
      rules,
      broken,
      ruleType: cfg.kind,
      noiseTraits: noise,
      explanation: `Rule: ${ruleText}. Specimen ${key + 1} breaks "${describeRule(rules[broken])}".`,
    };
  }
  throw new Error(`specimens: could not generate level ${level}`);
}

export const SPECIMENS_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.5, c: 1 / 9, timeLimitMs: 60_000 },
  { level: 2, a: 1.5, b: -0.7, c: 1 / 9, timeLimitMs: 75_000 },
  { level: 3, a: 1.6, b: 0.2, c: 1 / 9, timeLimitMs: 90_000 },
  { level: 4, a: 1.7, b: 1.0, c: 1 / 9, timeLimitMs: 105_000 },
  { level: 5, a: 1.7, b: 1.8, c: 1 / 9, timeLimitMs: 120_000 },
  { level: 6, a: 1.8, b: 2.6, c: 1 / 9, timeLimitMs: 135_000 },
  { level: 7, a: 1.9, b: 3.3, c: 1 / 9, timeLimitMs: 150_000 },
];

export const specimens = generatorParadigm<SpecimensContent, number>({
  id: 'specimens',
  version: 1,
  domain: 'natural',
  group: 'core',
  experimental: true,
  facet: 'pattern-anomaly',
  title: 'Specimen anomaly',
  subtitle: 'Nine organisms share a hidden pattern. One does not.',
  construct: 'Detecting covariation structure in natural-looking patterns.',
  instructions: [
    'Nine specimens follow one hidden pattern in their body plan and markings. One specimen breaks it.',
    'The pattern can link traits together, for example one feature always going with another.',
    'Some traits vary freely and mean nothing. Pick the specimen that breaks the pattern.',
  ],
  minutes: 5,
  minRtMs: 3000,
  levels: SPECIMENS_LEVELS,
  practiceLevels: [1, 3],
  generate(level, rng) {
    const item = generateSpecimens(level, rng);
    return {
      content: { specimens: item.specimens },
      key: item.key,
      response: { kind: 'choice', options: 9 },
      features: { rule: item.ruleType, noiseTraits: item.noiseTraits.length, rules: item.rules.length },
      explanation: item.explanation,
    };
  },
});
