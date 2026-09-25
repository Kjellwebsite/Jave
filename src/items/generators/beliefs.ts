/**
 * Recursive belief tracking (theory of mind). A short story is generated as an
 * explicit event log: agents leave and re-enter a room, move an object between
 * containers, and may watch a move secretly through the window. The keyed
 * answer is computed from a witness model, never authored. A factual memory
 * control accompanies every story (Kinderman, Dunbar & Bentall, 1998; Le et al., 2019).
 *
 * Belief model: a move enters the belief of chain [c1 … cn] iff c1 witnessed it
 * (present or secretly watching) and every later agent c2 … cn was openly present.
 * The belief of the chain is the location after the last move that entered it;
 * the initial placement is witnessed openly by everyone.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

const NAMES = ['Mara', 'Ilse', 'Tomas', 'Aiko', 'Nadia', 'Ravi', 'Sven', 'Lea', 'Omar', 'Zoe', 'Kofi', 'Yuki', 'Ana', 'Jonas', 'Leila', 'Priya'];
const OBJECTS = ['key', 'coin', 'letter', 'ring', 'ticket', 'marble', 'badge', 'stamp'];
const CONTAINERS = ['box', 'drawer', 'bag', 'basket', 'jar', 'cupboard', 'suitcase', 'chest', 'tin', 'crate'];

export type BeliefEvent =
  | { type: 'place'; agent: number; to: number }
  | { type: 'leave'; agent: number }
  | { type: 'enter'; agent: number }
  /** Starts watching the room secretly through the window (agent is outside). */
  | { type: 'watch'; agent: number }
  | { type: 'unwatch'; agent: number }
  | { type: 'move'; agent: number; from: number; to: number };

export interface BeliefsContent {
  story: string[];
  question: string;
  options: string[];
  control: { question: string; options: string[]; key: number };
  order: number;
}

interface BeliefLevel {
  level: number;
  order: number;
  agents: number;
  moves: number;
  /** Number of moves watched secretly through the window. */
  secret: number;
  containers: number;
}

const CONFIG: BeliefLevel[] = [
  { level: 1, order: 1, agents: 2, moves: 1, secret: 0, containers: 3 },
  { level: 2, order: 2, agents: 3, moves: 2, secret: 0, containers: 3 },
  { level: 3, order: 2, agents: 3, moves: 3, secret: 1, containers: 4 },
  { level: 4, order: 3, agents: 3, moves: 3, secret: 0, containers: 4 },
  { level: 5, order: 3, agents: 4, moves: 4, secret: 1, containers: 4 },
  { level: 6, order: 4, agents: 4, moves: 4, secret: 1, containers: 4 },
  { level: 7, order: 5, agents: 4, moves: 5, secret: 1, containers: 4 },
  { level: 8, order: 5, agents: 5, moves: 6, secret: 2, containers: 4 },
];

export const BELIEFS_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.3, b: -1.8, c: 1 / 3, timeLimitMs: 90_000 },
  { level: 2, a: 1.4, b: -0.8, c: 1 / 3, timeLimitMs: 105_000 },
  { level: 3, a: 1.5, b: 0.0, c: 0.25, timeLimitMs: 120_000 },
  { level: 4, a: 1.5, b: 0.7, c: 0.25, timeLimitMs: 120_000 },
  { level: 5, a: 1.6, b: 1.4, c: 0.25, timeLimitMs: 135_000 },
  { level: 6, a: 1.6, b: 2.2, c: 0.25, timeLimitMs: 150_000 },
  { level: 7, a: 1.7, b: 3.0, c: 0.25, timeLimitMs: 165_000 },
  { level: 8, a: 1.7, b: 3.6, c: 0.25, timeLimitMs: 180_000 },
];

/* ------------------------------------------------------------------ */
/* Belief model                                                         */
/* ------------------------------------------------------------------ */

/** Location (container index) the chain [c1 … cn] attributes to the object at the end. */
export function chainBelief(events: readonly BeliefEvent[], agents: number, chain: readonly number[]): number {
  const present = new Set(Array.from({ length: agents }, (_, i) => i));
  const watching = new Set<number>();
  let belief = -1;
  for (const e of events) {
    switch (e.type) {
      case 'place':
        belief = e.to;
        break;
      case 'leave':
        present.delete(e.agent);
        break;
      case 'enter':
        present.add(e.agent);
        break;
      case 'watch':
        watching.add(e.agent);
        break;
      case 'unwatch':
        watching.delete(e.agent);
        break;
      case 'move': {
        const [first, ...rest] = chain;
        if ((present.has(first) || watching.has(first)) && rest.every((a) => present.has(a))) belief = e.to;
        break;
      }
    }
  }
  return belief;
}

export const trueLocation = (events: readonly BeliefEvent[]) =>
  events.reduce((loc, e) => (e.type === 'place' || e.type === 'move' ? e.to : loc), -1);

/** All chains of the given order without an agent directly repeated. */
function chains(agents: number, order: number): number[][] {
  let out: number[][] = [[]];
  for (let k = 0; k < order; k++)
    out = out.flatMap((c) =>
      Array.from({ length: agents }, (_, a) => a)
        .filter((a) => c[c.length - 1] !== a)
        .map((a) => [...c, a]),
    );
  return out;
}

/* ------------------------------------------------------------------ */
/* Story simulation                                                     */
/* ------------------------------------------------------------------ */

function simulate(cfg: BeliefLevel, rng: Rng): BeliefEvent[] {
  const present = new Set(Array.from({ length: cfg.agents }, (_, i) => i));
  const agentsList = Array.from({ length: cfg.agents }, (_, i) => i);
  let loc = rng.int(0, cfg.containers - 1);
  const events: BeliefEvent[] = [{ type: 'place', agent: rng.pick(agentsList), to: loc }];
  const secretAt = new Set(rng.sample(Array.from({ length: cfg.moves }, (_, i) => i), cfg.secret));
  // Distinct agents per gap, so nobody leaves and returns without anything happening.
  const gap = (min: number, max: number) => {
    for (const a of rng.sample(agentsList, Math.min(cfg.agents, rng.int(min, max)))) {
      if (present.has(a)) {
        if (present.size > 1) {
          present.delete(a);
          events.push({ type: 'leave', agent: a });
        }
      } else {
        present.add(a);
        events.push({ type: 'enter', agent: a });
      }
    }
  };
  for (let m = 0; m < cfg.moves; m++) {
    gap(0, 2);
    let watcher = -1;
    if (secretAt.has(m)) {
      if (present.size === cfg.agents) {
        const a = rng.pick(agentsList);
        present.delete(a);
        events.push({ type: 'leave', agent: a });
      }
      watcher = rng.pick(agentsList.filter((a) => !present.has(a)));
      events.push({ type: 'watch', agent: watcher });
    }
    const mover = rng.pick([...present]);
    const to = rng.pick(Array.from({ length: cfg.containers }, (_, i) => i).filter((c) => c !== loc));
    events.push({ type: 'move', agent: mover, from: loc, to });
    loc = to;
    if (watcher >= 0) events.push({ type: 'unwatch', agent: watcher });
  }
  // Leaving after the last move does not change anyone's belief (true-belief distractor).
  gap(0, 1);
  return events;
}

/** Answer when secret watching is ignored (watchers see nothing) or treated as open presence. */
function secretVariants(events: readonly BeliefEvent[]): BeliefEvent[][] {
  const blind = events.filter((e) => e.type !== 'watch' && e.type !== 'unwatch');
  const open = events.map((e): BeliefEvent => (e.type === 'watch' ? { type: 'enter', agent: e.agent } : e.type === 'unwatch' ? { type: 'leave', agent: e.agent } : e));
  return [blind, open];
}

const listNames = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function renderEvent(e: BeliefEvent, names: string[], obj: string, boxes: string[]): string {
  const n = names[e.agent];
  switch (e.type) {
    case 'place':
      return `${n} puts the ${obj} in the ${boxes[e.to]}. Everyone sees this.`;
    case 'leave':
      return `${n} leaves the room.`;
    case 'enter':
      return `${n} comes back into the room.`;
    case 'watch':
      return `Outside, ${n} watches through the window without anyone noticing.`;
    case 'unwatch':
      return `${n} walks away from the window.`;
    case 'move':
      return `${n} moves the ${obj} from the ${boxes[e.from]} to the ${boxes[e.to]}.`;
  }
}

export function beliefQuestion(chain: readonly number[], names: readonly string[], obj: string): string {
  if (chain.length === 1) return `Where will ${names[chain[0]]} look for the ${obj}?`;
  const middle = chain.slice(1, -1).map((a) => `${names[a]} thinks `).join('');
  return `Where does ${names[chain[0]]} think ${middle}${names[chain[chain.length - 1]]} will look for the ${obj}?`;
}

type ControlKind = 'final' | 'mover' | 'presence';

function buildControl(
  events: BeliefEvent[],
  names: string[],
  obj: string,
  options: string[],
  optionOf: (container: number) => number,
  boxes: string[],
  rng: Rng,
): { control: BeliefsContent['control']; kind: ControlKind } {
  const moves = events.map((e, i) => ({ e, i })).filter((x) => x.e.type === 'move') as { e: Extract<BeliefEvent, { type: 'move' }>; i: number }[];
  const initial = trueLocation(events.slice(0, 1));
  // A destination reached once, and not where the object started, names one move unambiguously.
  const unique = moves.filter((m) => m.e.to !== initial && moves.filter((o) => o.e.to === m.e.to).length === 1);
  const kinds: ControlKind[] = unique.length ? ['final', 'mover', 'presence'] : ['final'];
  const kind = rng.pick(kinds);
  if (kind === 'final') {
    return { kind, control: { question: `Where is the ${obj} at the end of the story?`, options: options.slice(), key: optionOf(trueLocation(events)) } };
  }
  const target = rng.pick(unique);
  const where = boxes[target.e.to];
  if (kind === 'mover') {
    return { kind, control: { question: `Who moved the ${obj} to the ${where}?`, options: names.slice(), key: target.e.agent } };
  }
  const present = new Set(names.map((_, i) => i));
  for (const e of events.slice(0, target.i)) {
    if (e.type === 'leave') present.delete(e.agent);
    if (e.type === 'enter') present.add(e.agent);
  }
  const who = rng.pick(names.map((_, i) => i).filter((a) => a !== target.e.agent));
  return {
    kind,
    control: { question: `Was ${names[who]} in the room when the ${obj} was moved to the ${where}?`, options: ['Yes', 'No'], key: present.has(who) ? 0 : 1 },
  };
}

export interface GeneratedBeliefs {
  content: BeliefsContent;
  key: number;
  events: BeliefEvent[];
  agents: number;
  chain: number[];
  /** Container index shown at each option position. */
  optionContainers: number[];
  names: string[];
  containers: string[];
  object: string;
  controlKind: ControlKind;
}

export function generateBeliefs(level: number, rng: Rng): GeneratedBeliefs {
  const cfg = CONFIG.find((c) => c.level === level);
  if (!cfg) throw new Error(`beliefs: unknown level ${level}`);
  // Order 1: half the items are true-belief controls so "pick the old place" fails.
  const wantFalse = cfg.order > 1 || rng.chance(0.5);
  // Vary whether the answer is the starting container or an intermediate one.
  const avoidInitial = cfg.moves >= 2 && rng.chance(0.5);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const events = simulate(cfg, rng);
    const final = trueLocation(events);
    const initial = (events[0] as { to: number }).to;
    const visited = new Set(events.flatMap((e) => (e.type === 'place' || e.type === 'move' ? [e.to] : [])));
    if (visited.size < cfg.containers - 1) continue;
    if (!events.some((e) => e.type === 'leave')) continue;

    const valid = chains(cfg.agents, cfg.order).filter((chain) => {
      const ans = chainBelief(events, cfg.agents, chain);
      if (cfg.order === 1) {
        if (wantFalse !== (ans !== final)) return false;
        // The queried agent never moved the object and was absent at some point.
        if (events.some((e) => e.type === 'move' && e.agent === chain[0])) return false;
        if (!events.some((e) => e.type === 'leave' && e.agent === chain[0])) return false;
      } else {
        if (ans === final) return false;
        if (ans === chainBelief(events, cfg.agents, chain.slice(0, -1))) return false;
      }
      if (avoidInitial && ans === initial) return false;
      if (cfg.secret > 0 && secretVariants(events).every((v) => chainBelief(v, cfg.agents, chain) === ans)) return false;
      return true;
    });
    if (!valid.length) continue;
    const chain = rng.pick(valid);
    const answer = chainBelief(events, cfg.agents, chain);

    const names = rng.sample(NAMES, cfg.agents);
    const obj = rng.pick(OBJECTS);
    const boxes = rng.sample(CONTAINERS, cfg.containers);
    const optionContainers = rng.shuffle(boxes.map((_, i) => i));
    const options = optionContainers.map((c) => boxes[c]);
    const optionOf = (c: number) => optionContainers.indexOf(c);

    const story = [
      `${listNames(names)} are in a room.`,
      `There is ${listNames(boxes.map((b) => `a ${b}`))} in the room.`,
      ...events.map((e) => renderEvent(e, names, obj, boxes)),
    ];
    const { control, kind } = buildControl(events, names, obj, options, optionOf, boxes, rng);
    return {
      content: { story, question: beliefQuestion(chain, names, obj), options, control, order: cfg.order },
      key: optionOf(answer),
      events,
      agents: cfg.agents,
      chain,
      optionContainers,
      names,
      containers: boxes,
      object: obj,
      controlKind: kind,
    };
  }
  throw new Error(`beliefs: could not generate level ${level}`);
}

/** Compact event log for data export: P=place, L=leave, E=enter, W=watch, U=unwatch, M=move. */
const logString = (events: BeliefEvent[]) =>
  events
    .map((e) =>
      e.type === 'place' ? `P${e.agent}:${e.to}` : e.type === 'move' ? `M${e.agent}:${e.from}>${e.to}` : `${{ leave: 'L', enter: 'E', watch: 'W', unwatch: 'U' }[e.type]}${e.agent}`,
    )
    .join(' ');

export const beliefs = generatorParadigm<BeliefsContent, number>({
  id: 'beliefs',
  version: 1,
  domain: 'social',
  group: 'core',
  facet: 'theory-of-mind',
  title: 'Recursive beliefs',
  subtitle: 'Follow who saw what. Answer what they think.',
  construct: 'Theory of mind: tracking nested beliefs about where others think an object is.',
  instructions: [
    'Read the short story. People only know about moves they saw.',
    'Someone watching secretly through the window sees the move, but nobody in the room knows they saw it.',
    'Answer the question about what people think, then a short question about the story.',
  ],
  minutes: 6,
  minRtMs: 4000,
  levels: BELIEFS_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const g = generateBeliefs(level, rng);
    const cfg = CONFIG.find((c) => c.level === level)!;
    return {
      content: g.content,
      key: g.key,
      response: { kind: 'choice', options: g.content.options.length },
      features: {
        order: cfg.order,
        agents: cfg.agents,
        moves: cfg.moves,
        secret: cfg.secret,
        containers: cfg.containers,
        chain: g.chain.join(','),
        events: logString(g.events),
        control: g.controlKind,
      },
      explanation: `The ${g.object} ends in the ${g.containers[trueLocation(g.events)]}. Following who saw each move, the answer is the ${g.content.options[g.key]}.`,
    };
  },
  check(item, value, aux) {
    const correct = value.kind === 'choice' && value.index === item.key;
    if (aux && aux.kind === 'choice' && aux.index !== item.content.control.key) return { correct, excluded: 'memory-control' };
    return { correct };
  },
});
