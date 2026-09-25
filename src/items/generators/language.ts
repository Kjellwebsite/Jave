/**
 * Artificial language induction (Reber, 1967). A small invented language with
 * a random lexicon and a random subset of grammar rules is shown through 4–6
 * glossed examples. The user picks the translation of a new English sentence.
 * The 8 options form a balanced 2×2×2 design over three grammatical decisions
 * (correct or one specific misapplication each), so no option is modal and the
 * key cannot be found from the options alone (Hu et al., 2021).
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export type LangRule = 'order' | 'plural' | 'negation' | 'past' | 'agreement' | 'question' | 'possessive';
export type WordOrder = 'SVO' | 'SOV' | 'VSO';
/** A grammatical decision varied in the answer set. */
export type Decision = 'order' | 'role' | 'plural' | 'agree' | 'neg' | 'past' | 'question' | 'poss' | 'lexical';

export interface Grammar {
  rules: LangRule[];
  order: WordOrder;
  /** Noun plural suffix; also the verb's subject-agreement suffix. */
  plural: string;
  /** Verb prefix. */
  neg: string;
  /** Verb suffix. */
  past: string;
  /** Sentence-final question particle. */
  particle: string;
  /** Possessive linker: possessed LINKER possessor. */
  linker: string;
}

export interface NounPhrase {
  root: string;
  sg: string;
  pl: string;
  plural: boolean;
  possessor?: NounPhrase;
}

export interface Clause {
  subj: NounPhrase;
  verb: { root: string; base: string; s: string; past: string };
  obj: NounPhrase;
  neg: boolean;
  past: boolean;
  question: boolean;
}

export interface LanguageContent {
  examples: { native: string; english: string }[];
  target: string;
  options: string[];
}

interface NounDef {
  sg: string;
  pl: string;
  animate: boolean;
}
interface VerbDef {
  base: string;
  s: string;
  past: string;
  /** Object must be animate. */
  animateObj?: boolean;
}

const NOUNS: NounDef[] = [
  { sg: 'child', pl: 'children', animate: true },
  { sg: 'woman', pl: 'women', animate: true },
  { sg: 'farmer', pl: 'farmers', animate: true },
  { sg: 'friend', pl: 'friends', animate: true },
  { sg: 'horse', pl: 'horses', animate: true },
  { sg: 'bird', pl: 'birds', animate: true },
  { sg: 'dog', pl: 'dogs', animate: true },
  { sg: 'stone', pl: 'stones', animate: false },
  { sg: 'lamp', pl: 'lamps', animate: false },
  { sg: 'boat', pl: 'boats', animate: false },
  { sg: 'basket', pl: 'baskets', animate: false },
  { sg: 'rope', pl: 'ropes', animate: false },
];

const VERBS: VerbDef[] = [
  { base: 'see', s: 'sees', past: 'saw' },
  { base: 'carry', s: 'carries', past: 'carried' },
  { base: 'find', s: 'finds', past: 'found' },
  { base: 'hold', s: 'holds', past: 'held' },
  { base: 'wash', s: 'washes', past: 'washed' },
  { base: 'follow', s: 'follows', past: 'followed', animateObj: true },
  { base: 'hear', s: 'hears', past: 'heard', animateObj: true },
];

/** Pronounceable CV/CVC nonsense roots, screened against English words. */
const ROOTS = [
  'tavo', 'keluk', 'mirab', 'zonu', 'pelim', 'dasok', 'vuri', 'gonep', 'bilat', 'fusim', 'nerok', 'sabu',
  'lomif', 'ritak', 'kovel', 'dunip', 'zeram', 'hulo', 'timek', 'basor', 'gulim', 'pofa', 'nisuk', 'ralev',
  'fenub', 'sipor', 'dalu', 'vekon', 'zutim', 'lirap', 'kobem', 'talun', 'ferig', 'nodap', 'gesu', 'rumo',
];
const PLURALS = ['ek', 'ul', 'im', 'ot', 'an'];
const NEGS = ['mu', 'ze', 'ko', 'vi'];
const PASTS = ['ta', 'ri', 'no', 'sa'];
const PARTICLES = ['ka', 'de', 'po'];
const LINKERS = ['li', 'na', 'su'];

interface LangLevel {
  level: number;
  /** Rules always present. */
  fixed: LangRule[];
  /** Additional rules drawn from `pool`. */
  extra: number;
  pool: LangRule[];
  examples: number;
  nouns: number;
  verbs: number;
  /** Decision always varied in the answer set. */
  focus?: Decision;
}

const CONFIG: LangLevel[] = [
  { level: 1, fixed: [], extra: 1, pool: ['order', 'plural'], examples: 4, nouns: 4, verbs: 2 },
  { level: 2, fixed: [], extra: 2, pool: ['order', 'plural', 'negation', 'past'], examples: 4, nouns: 4, verbs: 2 },
  { level: 3, fixed: [], extra: 3, pool: ['order', 'plural', 'negation', 'past'], examples: 5, nouns: 5, verbs: 2 },
  { level: 4, fixed: ['plural', 'agreement'], extra: 1, pool: ['order', 'negation', 'past'], examples: 5, nouns: 5, verbs: 2, focus: 'agree' },
  { level: 5, fixed: [], extra: 4, pool: ['order', 'plural', 'negation', 'past', 'agreement'], examples: 6, nouns: 6, verbs: 2 },
  { level: 6, fixed: ['question'], extra: 3, pool: ['order', 'plural', 'negation', 'past', 'agreement'], examples: 6, nouns: 6, verbs: 2, focus: 'question' },
  {
    level: 7,
    fixed: ['possessive'],
    extra: 4,
    pool: ['order', 'plural', 'negation', 'past', 'agreement', 'question'],
    examples: 6,
    nouns: 7,
    verbs: 2,
    focus: 'poss',
  },
];

export const LANGUAGE_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.2, c: 0.125, timeLimitMs: 90_000 },
  { level: 2, a: 1.6, b: -0.4, c: 0.125, timeLimitMs: 105_000 },
  { level: 3, a: 1.6, b: 0.4, c: 0.125, timeLimitMs: 120_000 },
  { level: 4, a: 1.7, b: 1.2, c: 0.125, timeLimitMs: 135_000 },
  { level: 5, a: 1.8, b: 2.0, c: 0.125, timeLimitMs: 150_000 },
  { level: 6, a: 1.8, b: 2.8, c: 0.125, timeLimitMs: 165_000 },
  { level: 7, a: 1.9, b: 3.5, c: 0.125, timeLimitMs: 180_000 },
];

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function englishNP(np: NounPhrase): string {
  const word = np.plural ? np.pl : np.sg;
  return np.possessor ? `${englishNP(np.possessor)}'s ${word}` : `the ${word}`;
}

export function renderEnglish(c: Clause): string {
  const S = englishNP(c.subj);
  const O = englishNP(c.obj);
  const pl = c.subj.plural;
  if (c.question) return `${c.past ? 'Did' : pl ? 'Do' : 'Does'} ${S}${c.neg ? ' not' : ''} ${c.verb.base} ${O}?`;
  if (c.neg) return cap(`${S} ${c.past ? 'did' : pl ? 'do' : 'does'} not ${c.verb.base} ${O}.`);
  return cap(`${S} ${c.past ? c.verb.past : pl ? c.verb.base : c.verb.s} ${O}.`);
}

/** Roots from head to deepest possessor. */
const npChain = (np: NounPhrase): NounPhrase[] => (np.possessor ? [np, ...npChain(np.possessor)] : [np]);

/**
 * Native sentence. Each decision in `errors` applies its one misapplication:
 * order → English order (or SOV when the true order is SVO); role → subject and object swap places;
 * plural → the suffix marks the other noun; agree → the verb agrees with the object;
 * neg → negation as a suffix; past → tense as a prefix; question → particle without verb fronting;
 * poss → possessor first (English order); lexical → another verb root.
 */
export function renderNative(c: Clause, g: Grammar, errors: ReadonlySet<Decision> = new Set(), altVerb?: string): string {
  const has = (r: LangRule) => g.rules.includes(r);
  const swapMarks = errors.has('plural');
  const np = (x: NounPhrase, marked: boolean) => {
    const chain = npChain(x).map((n, i) => (i === 0 && marked ? n.root + g.plural : n.root));
    return (errors.has('poss') ? chain.reverse() : chain).join(` ${g.linker} `);
  };
  const S = np(c.subj, swapMarks ? c.obj.plural : c.subj.plural);
  const O = np(c.obj, swapMarks ? c.subj.plural : c.obj.plural);
  const agrees = has('agreement') && (errors.has('agree') ? c.obj.plural : c.subj.plural);
  const root = errors.has('lexical') && altVerb ? altVerb : c.verb.root;
  const V =
    (c.neg && !errors.has('neg') ? g.neg : '') +
    (c.past && errors.has('past') ? g.past : '') +
    root +
    (c.past && !errors.has('past') ? g.past : '') +
    (agrees ? g.plural : '') +
    (c.neg && errors.has('neg') ? g.neg : '');
  const [first, second] = errors.has('role') ? [O, S] : [S, O];
  const order: WordOrder = errors.has('order') ? (g.order === 'SVO' ? 'SOV' : 'SVO') : g.order;
  const base = order === 'SVO' ? [first, V, second] : order === 'SOV' ? [first, second, V] : [V, first, second];
  if (c.question) {
    const words = errors.has('question') ? [...base, g.particle] : [V, first, second, g.particle];
    return `${cap(words.join(' '))}?`;
  }
  return `${cap(base.join(' '))}.`;
}

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

interface Lexicon {
  nouns: (NounDef & { root: string })[];
  verbs: (VerbDef & { root: string })[];
}

function pickRules(cfg: LangLevel, rng: Rng): LangRule[] {
  for (;;) {
    const rules = [...cfg.fixed, ...rng.sample(cfg.pool, cfg.extra)];
    if (rules.includes('agreement') && !rules.includes('plural')) continue;
    return rules;
  }
}

function makeGrammar(rules: LangRule[], rng: Rng): Grammar {
  const orders: WordOrder[] = rules.includes('question') ? ['SOV'] : ['SOV', 'VSO'];
  return {
    rules,
    order: rules.includes('order') ? rng.pick(orders) : 'SVO',
    plural: rng.pick(PLURALS),
    neg: rng.pick(NEGS),
    past: rng.pick(PASTS),
    particle: rng.pick(PARTICLES),
    linker: rng.pick(LINKERS),
  };
}

function makeLexicon(cfg: LangLevel, g: Grammar, rng: Rng): Lexicon {
  const roots = rng.shuffle(ROOTS.filter((r) => !r.startsWith(g.neg) && !r.endsWith(g.plural) && !r.endsWith(g.past)));
  // At least three animate nouns so that subjects, objects and possessors vary.
  let nouns: NounDef[];
  do nouns = rng.sample(NOUNS, cfg.nouns);
  while (nouns.filter((n) => n.animate).length < 3 || nouns.every((n) => n.animate));
  const verbs = rng.sample(VERBS, cfg.verbs);
  return {
    nouns: nouns.map((n, i) => ({ ...n, root: roots[i] })),
    verbs: verbs.map((v, i) => ({ ...v, root: roots[cfg.nouns + i] })),
  };
}

interface ClauseSpec {
  neg: boolean;
  past: boolean;
  question: boolean;
  subjPlural: boolean;
  objPlural: boolean;
  /** Possessor depth on the subject or object (0 = none). */
  possDepth: number;
}

function buildClause(spec: ClauseSpec, lex: Lexicon, rng: Rng): Clause | null {
  const animate = lex.nouns.filter((n) => n.animate);
  const verb = rng.pick(lex.verbs);
  const subjDef = rng.pick(animate);
  const objPool = (verb.animateObj ? animate : lex.nouns).filter((n) => n !== subjDef);
  if (!objPool.length) return null;
  const objDef = rng.pick(objPool);
  const used = new Set([subjDef, objDef]);
  const phrase = (d: NounDef & { root: string }, plural: boolean): NounPhrase => ({ root: d.root, sg: d.sg, pl: d.pl, plural });
  const subj = phrase(subjDef, spec.subjPlural);
  const obj = phrase(objDef, spec.objPlural);
  if (spec.possDepth > 0) {
    let host = rng.chance(0.5) ? subj : obj;
    for (let k = 0; k < spec.possDepth; k++) {
      const free = animate.filter((n) => !used.has(n));
      if (!free.length) return null;
      const d = rng.pick(free);
      used.add(d);
      host.possessor = phrase(d, false);
      host = host.possessor;
    }
  }
  return { subj, verb, obj, neg: spec.neg, past: spec.past, question: spec.question };
}

const nounRoots = (c: Clause) => [...npChain(c.subj), ...npChain(c.obj)].map((n) => n.root);
const clauseRoots = (c: Clause) => [...nounRoots(c), c.verb.root];

/** Every rule needed for the target is shown by a contrast in the examples. */
function demonstrates(examples: Clause[], rules: LangRule[]): boolean {
  const has = (r: LangRule) => rules.includes(r);
  const declaratives = examples.filter((c) => !c.question);
  if (declaratives.length < 2) return false;
  if (has('plural')) {
    const forms = new Map<string, Set<boolean>>();
    for (const c of examples) for (const n of [c.subj, c.obj]) forms.set(n.root, (forms.get(n.root) ?? new Set()).add(n.plural));
    if (![...forms.values()].some((s) => s.size === 2)) return false;
  }
  if (has('negation') && !(examples.some((c) => c.neg) && examples.some((c) => !c.neg))) return false;
  if (has('past') && !(examples.some((c) => c.past) && examples.some((c) => !c.past))) return false;
  if (has('agreement')) {
    if (!examples.some((c) => c.subj.plural && !c.obj.plural)) return false;
    if (!examples.some((c) => !c.subj.plural && c.obj.plural)) return false;
  }
  if (has('question') && !examples.some((c) => c.question)) return false;
  if (has('possessive') && !examples.some((c) => c.subj.possessor || c.obj.possessor)) return false;
  return true;
}

export interface GeneratedLanguage {
  content: LanguageContent;
  key: number;
  grammar: Grammar;
  target: Clause;
  exampleClauses: Clause[];
  decisions: Decision[];
  /** Per option: bit i set when decision i takes its wrong value. The key has code 0. */
  codes: number[];
  altVerb: string;
}

export function generateLanguage(level: number, rng: Rng): GeneratedLanguage {
  const cfg = CONFIG.find((c) => c.level === level);
  if (!cfg) throw new Error(`language: unknown level ${level}`);
  for (let attempt = 0; attempt < 500; attempt++) {
    const rules = pickRules(cfg, rng);
    const g = makeGrammar(rules, rng);
    const lex = makeLexicon(cfg, g, rng);
    const has = (r: LangRule) => rules.includes(r);

    // Target uses every rule of the level. Exactly one noun is plural so that
    // plural placement and agreement are both testable.
    const subjPl = has('plural') && rng.chance(0.5);
    const target = buildClause(
      {
        neg: has('negation'),
        past: has('past'),
        question: has('question'),
        subjPlural: subjPl,
        objPlural: has('plural') && !subjPl,
        possDepth: has('possessive') ? 2 : 0,
      },
      lex,
      rng,
    );
    if (!target) continue;

    for (let tries = 0; tries < 60; tries++) {
      const exampleClauses: Clause[] = [];
      for (let k = 0; k < cfg.examples; k++) {
        const c = buildClause(
          {
            neg: has('negation') && rng.chance(0.5),
            past: has('past') && rng.chance(0.5),
            question: has('question') && rng.chance(0.35),
            subjPlural: has('plural') && rng.chance(0.45),
            objPlural: has('plural') && rng.chance(0.45),
            possDepth: has('possessive') && rng.chance(0.5) ? 1 : 0,
          },
          lex,
          rng,
        );
        if (c) exampleClauses.push(c);
      }
      if (exampleClauses.length !== cfg.examples) continue;
      const exampleRoots = new Set(exampleClauses.flatMap(clauseRoots));
      if (!clauseRoots(target).every((r) => exampleRoots.has(r))) continue;
      if (!demonstrates(exampleClauses, rules)) continue;
      const natives = exampleClauses.map((c) => renderNative(c, g));
      if (new Set(natives).size !== natives.length) continue;
      const correct = renderNative(target, g);
      if (natives.includes(correct)) continue;

      // Decisions: rules shown by the target first, then neutral fillers.
      const exampleVerbs = [...new Set(exampleClauses.map((c) => c.verb.root))].filter((r) => r !== target.verb.root);
      const ruleDecisions: Decision[] = [];
      if (has('order') && !target.question) ruleDecisions.push('order');
      if (has('plural')) ruleDecisions.push('plural');
      if (has('agreement')) ruleDecisions.push('agree');
      if (has('negation')) ruleDecisions.push('neg');
      if (has('past')) ruleDecisions.push('past');
      if (has('question')) ruleDecisions.push('question');
      if (has('possessive')) ruleDecisions.push('poss');
      const fillers: Decision[] = ['role'];
      if (!has('order') && !target.question) fillers.push('order');
      if (exampleVerbs.length) fillers.push('lexical');
      const focus = cfg.focus ? [cfg.focus] : [];
      const decisions = [...focus, ...rng.shuffle(ruleDecisions.filter((d) => d !== cfg.focus)), ...rng.shuffle(fillers)].slice(0, 3);
      if (decisions.length < 3) break;
      const altVerb = exampleVerbs.length ? rng.pick(exampleVerbs) : target.verb.root;

      // Balanced 2 × 2 × 2 answer set.
      const all = Array.from({ length: 8 }, (_, m) => renderNative(target, g, new Set(decisions.filter((_, i) => m & (1 << i))), altVerb));
      if (new Set(all).size !== 8) continue;
      if (all.some((o) => natives.includes(o))) continue;
      const codes = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
      return {
        content: {
          examples: exampleClauses.map((c, i) => ({ native: natives[i], english: renderEnglish(c) })),
          target: renderEnglish(target),
          options: codes.map((m) => all[m]),
        },
        key: codes.indexOf(0),
        grammar: g,
        target,
        exampleClauses,
        decisions,
        codes,
        altVerb,
      };
    }
  }
  throw new Error(`language: could not generate level ${level}`);
}

function describe(g: Grammar): string {
  const parts = [`word order ${g.order}`];
  if (g.rules.includes('plural')) parts.push(`plural suffix -${g.plural}`);
  if (g.rules.includes('agreement')) parts.push(`verb takes -${g.plural} when the subject is plural`);
  if (g.rules.includes('negation')) parts.push(`negation prefix ${g.neg}-`);
  if (g.rules.includes('past')) parts.push(`past suffix -${g.past}`);
  if (g.rules.includes('question')) parts.push(`questions put the verb first and end with "${g.particle}"`);
  if (g.rules.includes('possessive')) parts.push(`possessed "${g.linker}" possessor`);
  return parts.join('; ');
}

export const language = generatorParadigm<LanguageContent, number>({
  id: 'language',
  version: 1,
  domain: 'language',
  group: 'core',
  facet: 'linguistic-induction',
  load: 'reasoning',
  title: 'Artificial language',
  subtitle: 'Learn the grammar from examples. Translate.',
  construct: 'Linguistic pattern induction: inferring word order and grammatical markers from a few examples.',
  instructions: [
    'The examples show sentences in an invented language with their English meaning.',
    'Work out the words and how the language marks things like number, tense or negation.',
    'Then choose the correct translation of the new English sentence.',
  ],
  minutes: 6,
  minRtMs: 4000,
  levels: LANGUAGE_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const g = generateLanguage(level, rng);
    return {
      content: g.content,
      key: g.key,
      response: { kind: 'choice', options: 8 },
      features: {
        rules: g.grammar.rules.length,
        ruleSet: g.grammar.rules.join(','),
        order: g.grammar.order,
        decisions: g.decisions.join(','),
        examples: g.content.examples.length,
      },
      explanation: `${cap(describe(g.grammar))}.`,
    };
  },
});
