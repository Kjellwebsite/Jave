import { describe, expect, it } from 'vitest';
import { beliefs, BELIEFS_LEVELS, generateBeliefs, type BeliefEvent } from '../src/items/generators/beliefs';
import { generateLanguage, language, LANGUAGE_LEVELS, type Clause, type Grammar, type NounPhrase } from '../src/items/generators/language';
import { createRng } from '../src/utils/rng';

/* ------------------------------------------------------------------ */
/* Beliefs: independent parser and belief model                         */
/* ------------------------------------------------------------------ */

type Parsed =
  | { t: 'place'; who: string; to: string }
  | { t: 'leave' | 'enter' | 'watch' | 'unwatch'; who: string }
  | { t: 'move'; who: string; from: string; to: string };

const splitList = (s: string) => s.split(/, | and /);

/** Rebuild the event log from the story text alone. */
function parseStory(story: string[], obj: string): { names: string[]; containers: string[]; events: Parsed[] } {
  const names = splitList(story[0].match(/^(.+) are in a room\.$/)![1]);
  const containers = splitList(story[1].match(/^There is (.+) in the room\.$/)![1]).map((s) => s.replace(/^a /, ''));
  const events: Parsed[] = story.slice(2).map((line) => {
    let m: RegExpMatchArray | null;
    if ((m = line.match(new RegExp(`^(\\w+) puts the ${obj} in the (\\w+)\\. Everyone sees this\\.$`)))) return { t: 'place', who: m[1], to: m[2] };
    if ((m = line.match(/^(\w+) leaves the room\.$/))) return { t: 'leave', who: m[1] };
    if ((m = line.match(/^(\w+) comes back into the room\.$/))) return { t: 'enter', who: m[1] };
    if ((m = line.match(/^Outside, (\w+) watches through the window without anyone noticing\.$/))) return { t: 'watch', who: m[1] };
    if ((m = line.match(/^(\w+) walks away from the window\.$/))) return { t: 'unwatch', who: m[1] };
    if ((m = line.match(new RegExp(`^(\\w+) moves the ${obj} from the (\\w+) to the (\\w+)\\.$`)))) return { t: 'move', who: m[1], from: m[2], to: m[3] };
    throw new Error(`unparsed story line: ${line}`);
  });
  return { names, containers, events };
}

function parseChain(question: string, obj: string): string[] {
  let m = question.match(new RegExp(`^Where will (\\w+) look for the ${obj}\\?$`));
  if (m) return [m[1]];
  m = question.match(new RegExp(`^Where does (\\w+) think ((?:\\w+ thinks )*)(\\w+) will look for the ${obj}\\?$`));
  if (!m) throw new Error(`unparsed question: ${question}`);
  const middle = m[2].split(' thinks ').filter(Boolean);
  return [m[1], ...middle, m[3]];
}

interface Witnessed {
  to: string;
  open: Set<string>;
  secret: Set<string>;
}

/** Witness sets for every move, with sanity checks on presence. */
function witnessLog(names: string[], events: Parsed[]): { initial: string; moves: Witnessed[] } {
  const inRoom = new Set(names);
  const atWindow = new Set<string>();
  let where = '';
  let initial = '';
  const moves: Witnessed[] = [];
  for (const e of events) {
    if (e.t === 'place') {
      expect(inRoom.size).toBe(names.length);
      initial = where = e.to;
    } else if (e.t === 'leave') {
      expect(inRoom.has(e.who)).toBe(true);
      inRoom.delete(e.who);
    } else if (e.t === 'enter') {
      expect(inRoom.has(e.who)).toBe(false);
      inRoom.add(e.who);
    } else if (e.t === 'watch') {
      expect(inRoom.has(e.who)).toBe(false);
      atWindow.add(e.who);
    } else if (e.t === 'unwatch') {
      expect(atWindow.has(e.who)).toBe(true);
      atWindow.delete(e.who);
    } else if (e.t === 'move') {
      expect(inRoom.has(e.who)).toBe(true);
      expect(e.from).toBe(where);
      expect(e.to).not.toBe(where);
      where = e.to;
      moves.push({ to: e.to, open: new Set(inRoom), secret: new Set(atWindow) });
    }
  }
  return { initial, moves };
}

function beliefOf(log: { initial: string; moves: Witnessed[] }, chain: string[]): string {
  let loc = log.initial;
  for (const m of log.moves) {
    const firstSaw = m.open.has(chain[0]) || m.secret.has(chain[0]);
    if (firstSaw && chain.slice(1).every((a) => m.open.has(a))) loc = m.to;
  }
  return loc;
}

const TABLE: Record<number, { order: number; agents: number; moves: number; secret: number }> = {
  1: { order: 1, agents: 2, moves: 1, secret: 0 },
  2: { order: 2, agents: 3, moves: 2, secret: 0 },
  3: { order: 2, agents: 3, moves: 3, secret: 1 },
  4: { order: 3, agents: 3, moves: 3, secret: 0 },
  5: { order: 3, agents: 4, moves: 4, secret: 1 },
  6: { order: 4, agents: 4, moves: 4, secret: 1 },
  7: { order: 5, agents: 4, moves: 5, secret: 1 },
  8: { order: 5, agents: 5, moves: 6, secret: 2 },
};

describe('beliefs generator', () => {
  it('keys every level with the witness model recomputed from the story text', () => {
    for (const { level } of BELIEFS_LEVELS) {
      const spec = TABLE[level];
      const keyCounts = new Map<number, number>();
      for (let s = 0; s < 40; s++) {
        const g = generateBeliefs(level, createRng(level * 1000 + s));
        const { story, question, options, control, order } = g.content;
        expect(order).toBe(spec.order);
        const parsed = parseStory(story, g.object);
        expect(parsed.names).toHaveLength(spec.agents);
        expect(parsed.events).toHaveLength(g.events.length);

        // Parsed log matches the exported structured log.
        parsed.events.forEach((p, i) => {
          const e: BeliefEvent = g.events[i];
          expect(p.t).toBe(e.type);
          expect(p.who).toBe(g.names[e.agent]);
          if (e.type === 'move' && p.t === 'move') {
            expect(p.from).toBe(g.containers[e.from]);
            expect(p.to).toBe(g.containers[e.to]);
          }
        });
        expect(parsed.events.filter((e) => e.t === 'move')).toHaveLength(spec.moves);
        expect(parsed.events.filter((e) => e.t === 'watch')).toHaveLength(spec.secret);

        // Options are exactly the containers in the room, all mentioned, at most one never used.
        expect([...options].sort()).toEqual([...parsed.containers].sort());
        const visited = new Set(parsed.events.flatMap((e) => (e.t === 'place' || e.t === 'move' ? [e.to] : [])));
        expect(options.filter((o) => !visited.has(o)).length).toBeLessThanOrEqual(1);
        for (const o of options) expect(story.join(' ')).toContain(o);

        const chain = parseChain(question, g.object);
        expect(chain).toHaveLength(spec.order);
        expect(chain).toEqual(g.chain.map((a) => g.names[a]));
        const log = witnessLog(parsed.names, parsed.events);
        const answer = beliefOf(log, chain);
        expect(options[g.key]).toBe(answer);
        keyCounts.set(g.key, (keyCounts.get(g.key) ?? 0) + 1);

        const final = log.moves[log.moves.length - 1].to;
        if (spec.order === 1) {
          // Not trivially answerable: the queried agent never moved the object and was absent at some point.
          expect(parsed.events.some((e) => e.t === 'move' && e.who === chain[0])).toBe(false);
          expect(parsed.events.some((e) => e.t === 'leave' && e.who === chain[0])).toBe(true);
        }
        if (spec.order >= 2) {
          expect(answer).not.toBe(final);
          expect(answer).not.toBe(beliefOf(log, chain.slice(0, -1)));
        }

        // Memory control.
        expect(control.key).toBeGreaterThanOrEqual(0);
        expect(control.key).toBeLessThan(control.options.length);
        let m: RegExpMatchArray | null;
        if ((m = control.question.match(/^Where is the \w+ at the end of the story\?$/))) {
          expect(control.options[control.key]).toBe(final);
        } else if ((m = control.question.match(/^Who moved the \w+ to the (\w+)\?$/))) {
          const moves = parsed.events.filter((e): e is Extract<Parsed, { t: 'move' }> => e.t === 'move' && e.to === m![1]);
          expect(moves).toHaveLength(1);
          expect(control.options[control.key]).toBe(moves[0].who);
        } else if ((m = control.question.match(/^Was (\w+) in the room when the \w+ was moved to the (\w+)\?$/))) {
          const idx = log.moves.findIndex((w) => w.to === m![2]);
          expect(log.moves.filter((w) => w.to === m![2])).toHaveLength(1);
          expect(control.options[control.key]).toBe(log.moves[idx].open.has(m[1]) ? 'Yes' : 'No');
        } else throw new Error(`unknown control: ${control.question}`);
      }
      // The keyed position varies across items.
      expect(keyCounts.size).toBeGreaterThan(1);
    }
  });

  it('is deterministic and excludes items with a failed memory control', () => {
    const a = beliefs.instantiate('5', createRng(42));
    const b = beliefs.instantiate('5', createRng(42));
    expect(a).toEqual(b);
    const item = a as typeof a & { content: { control: { key: number; options: string[] } } };
    const ck = item.content.control.key;
    const wrong = (ck + 1) % item.content.control.options.length;
    const key = item.key as number;
    expect(beliefs.score(a, { kind: 'choice', index: key }, { kind: 'choice', index: ck })).toEqual({ correct: true });
    expect(beliefs.score(a, { kind: 'choice', index: key }, { kind: 'choice', index: wrong })).toEqual({ correct: true, excluded: 'memory-control' });
    expect(beliefs.score(a, { kind: 'choice', index: (key + 1) % 3 })).toEqual({ correct: false });
    expect(a.response).toEqual({ kind: 'choice', options: (a.content as { options: string[] }).options.length });
  });
});

/* ------------------------------------------------------------------ */
/* Language: independent renderer                                       */
/* ------------------------------------------------------------------ */

function nativeOf(c: Clause, g: Grammar, wrong: Set<string>, altVerb: string): string {
  const rule = new Set(g.rules);
  const heads = (np: NounPhrase): string[] => {
    const out: string[] = [];
    for (let n: NounPhrase | undefined = np; n; n = n.possessor) out.push(n.root);
    return out;
  };
  const phrase = (np: NounPhrase, plural: boolean) => {
    const words = heads(np);
    if (plural) words[0] += g.plural;
    if (wrong.has('poss')) words.reverse();
    return words.join(' ' + g.linker + ' ');
  };
  const subjMarked = wrong.has('plural') ? c.obj.plural : c.subj.plural;
  const objMarked = wrong.has('plural') ? c.subj.plural : c.obj.plural;
  let s = phrase(c.subj, subjMarked);
  let o = phrase(c.obj, objMarked);
  if (wrong.has('role')) [s, o] = [o, s];
  let v = wrong.has('lexical') ? altVerb : c.verb.root;
  if (c.past) v = wrong.has('past') ? g.past + v : v + g.past;
  if (rule.has('agreement') && (wrong.has('agree') ? c.obj.plural : c.subj.plural)) v += g.plural;
  if (c.neg) v = wrong.has('neg') ? v + g.neg : g.neg + v;
  const order = wrong.has('order') ? (g.order === 'SVO' ? 'SOV' : 'SVO') : g.order;
  const slots: Record<string, string> = { S: s, V: v, O: o };
  let words = order.split('').map((k) => slots[k]);
  if (c.question) words = wrong.has('question') ? [...words, g.particle] : [v, s, o, g.particle];
  const text = words.join(' ');
  return text[0].toUpperCase() + text.slice(1) + (c.question ? '?' : '.');
}

const RULE_COUNT: Record<number, { n: number; must?: string }> = {
  1: { n: 1 },
  2: { n: 2 },
  3: { n: 3 },
  4: { n: 3, must: 'agreement' },
  5: { n: 4 },
  6: { n: 4, must: 'question' },
  7: { n: 5, must: 'possessive' },
};

const DECISION_RULE: Record<string, string> = {
  plural: 'plural',
  agree: 'agreement',
  neg: 'negation',
  past: 'past',
  question: 'question',
  poss: 'possessive',
};

const rootsOf = (np: NounPhrase): string[] => (np.possessor ? [np.root, ...rootsOf(np.possessor)] : [np.root]);

describe('language generator', () => {
  it('builds a balanced 2×2×2 answer set with exactly one correct translation', () => {
    for (const { level } of LANGUAGE_LEVELS) {
      const keyCounts = new Map<number, number>();
      for (let s = 0; s < 40; s++) {
        const g = generateLanguage(level, createRng(level * 1000 + s));
        const { examples, options, target } = g.content;
        const rules = g.grammar.rules;

        expect(rules).toHaveLength(RULE_COUNT[level].n);
        if (RULE_COUNT[level].must) expect(rules).toContain(RULE_COUNT[level].must);
        if (rules.includes('agreement')) expect(rules).toContain('plural');
        expect(examples.length).toBeGreaterThanOrEqual(4);
        expect(examples.length).toBeLessThanOrEqual(6);

        // Exactly one option is the true translation, and it is the key.
        expect(options).toHaveLength(8);
        expect(new Set(options).size).toBe(8);
        const correct = nativeOf(g.target, g.grammar, new Set(), g.altVerb);
        expect(options.filter((o) => o === correct)).toHaveLength(1);
        expect(options[g.key]).toBe(correct);
        keyCounts.set(g.key, (keyCounts.get(g.key) ?? 0) + 1);

        // Balance: every decision is wrong in exactly four options, and each option is its code.
        expect(new Set(g.decisions).size).toBe(3);
        expect([...g.codes].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        for (let bit = 0; bit < 3; bit++) expect(g.codes.filter((c) => c & (1 << bit))).toHaveLength(4);
        options.forEach((o, i) => {
          const wrong = new Set(g.decisions.filter((_, b) => g.codes[i] & (1 << b)));
          expect(o).toBe(nativeOf(g.target, g.grammar, wrong, g.altVerb));
        });
        // Rule decisions only concern rules that the language has.
        for (const d of g.decisions) if (DECISION_RULE[d]) expect(rules).toContain(DECISION_RULE[d]);

        // The target uses every rule of the level.
        expect(g.target.neg).toBe(rules.includes('negation'));
        expect(g.target.past).toBe(rules.includes('past'));
        expect(g.target.question).toBe(rules.includes('question'));
        if (rules.includes('possessive')) expect(rootsOf(g.target.subj).length + rootsOf(g.target.obj).length).toBe(4);

        // Vocabulary and rules appear in the examples; the target does not.
        const ex = g.exampleClauses;
        expect(examples.map((e) => e.native)).toEqual(ex.map((c) => nativeOf(c, g.grammar, new Set(), g.altVerb)));
        const exRoots = new Set(ex.flatMap((c) => [...rootsOf(c.subj), ...rootsOf(c.obj), c.verb.root]));
        for (const r of [...rootsOf(g.target.subj), ...rootsOf(g.target.obj), g.target.verb.root]) {
          expect(exRoots.has(r)).toBe(true);
          expect(examples.some((e) => e.native.toLowerCase().includes(r))).toBe(true);
        }
        expect(examples.map((e) => e.english)).not.toContain(target);
        for (const o of options) expect(examples.map((e) => e.native)).not.toContain(o);
        if (rules.includes('negation')) expect(ex.some((c) => c.neg) && ex.some((c) => !c.neg)).toBe(true);
        if (rules.includes('past')) expect(ex.some((c) => c.past) && ex.some((c) => !c.past)).toBe(true);
        if (rules.includes('plural')) expect(ex.some((c) => c.subj.plural || c.obj.plural)).toBe(true);
        if (rules.includes('agreement')) {
          expect(ex.some((c) => c.subj.plural && !c.obj.plural)).toBe(true);
          expect(ex.some((c) => !c.subj.plural && c.obj.plural)).toBe(true);
        }
        if (rules.includes('question')) expect(ex.some((c) => c.question)).toBe(true);
        if (rules.includes('possessive')) expect(ex.some((c) => c.subj.possessor || c.obj.possessor)).toBe(true);
        expect(ex.filter((c) => !c.question).length).toBeGreaterThanOrEqual(2);

        // Roots are CV/CVC nonsense syllables.
        for (const r of exRoots) expect(r).toMatch(/^([bdfghklmnprstvz][aeiou][bdfghklmnprstvz]?)+$/);
        // English target reflects the features.
        if (g.target.neg) expect(target).toMatch(/ not /);
        if (g.target.question) expect(target.endsWith('?')).toBe(true);
      }
      expect(keyCounts.size).toBeGreaterThan(3);
    }
  });

  it('is deterministic and scored by index', () => {
    const a = language.instantiate('4', createRng(9));
    expect(language.instantiate('4', createRng(9))).toEqual(a);
    expect(a.response).toEqual({ kind: 'choice', options: 8 });
    expect(language.score(a, { kind: 'choice', index: a.key as number }).correct).toBe(true);
    expect(language.score(a, { kind: 'choice', index: ((a.key as number) + 1) % 8 }).correct).toBe(false);
  });
});
