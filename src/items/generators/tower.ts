/**
 * Planning: one-touch Tower of London. The user sees a start and a goal
 * configuration and states the minimum number of moves. Minimum moves come
 * from breadth-first search over the full state space of each variant; the
 * state graph is built once per variant and cached. Detour moves (optimal
 * moves that put a ball somewhere other than its goal position) are minimised
 * over all optimal paths by dynamic programming on the shortest-path DAG.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

/** Pegs, each listed bottom → top. Balls are ids 0..n−1. */
type Pegs = number[][];

/** An edge of the state graph: which ball lands where, and the state it leads to. */
interface Move {
  to: number;
  ball: number;
  peg: number;
  height: number;
}

interface Variant {
  balls: number;
  capacities: number[];
}

interface Graph {
  states: Pegs[];
  index: Map<string, number>;
  adj: Move[][];
}

const VARIANTS: Record<3 | 4, Variant> = {
  3: { balls: 3, capacities: [3, 2, 1] },
  4: { balls: 4, capacities: [4, 3, 2, 1] },
};

export const pegsKey = (pegs: Pegs) => pegs.map((p) => p.join(',')).join('|');

/** Every legal successor of `pegs`: the top ball of one peg onto another peg with room. */
export function towerMoves(pegs: Pegs, capacities: number[]): { next: Pegs; ball: number; peg: number; height: number }[] {
  const out: { next: Pegs; ball: number; peg: number; height: number }[] = [];
  pegs.forEach((from, i) => {
    if (!from.length) return;
    const ball = from[from.length - 1];
    pegs.forEach((onto, j) => {
      if (i === j || onto.length >= capacities[j]) return;
      const next = pegs.map((p) => p.slice());
      next[i].pop();
      next[j].push(ball);
      out.push({ next, ball, peg: j, height: onto.length });
    });
  });
  return out;
}

const graphs = new Map<number, Graph>();

function graphFor(v: Variant): Graph {
  const cached = graphs.get(v.balls);
  if (cached) return cached;
  const first: Pegs = v.capacities.map(() => []);
  first[0] = Array.from({ length: v.balls }, (_, i) => i);
  const states: Pegs[] = [first];
  const index = new Map([[pegsKey(first), 0]]);
  const adj: Move[][] = [];
  for (let s = 0; s < states.length; s++) {
    adj[s] = towerMoves(states[s], v.capacities).map(({ next, ball, peg, height }) => {
      const k = pegsKey(next);
      let to = index.get(k);
      if (to === undefined) {
        to = states.length;
        index.set(k, to);
        states.push(next);
      }
      return { to, ball, peg, height };
    });
  }
  const g = { states, index, adj };
  graphs.set(v.balls, g);
  return g;
}

interface GoalAnalysis {
  /** Minimum moves from each state to the goal. */
  dist: Int16Array;
  /** Fewest detour moves over all optimal paths from each state to the goal. */
  detour: Int16Array;
}

const analyses = new Map<string, GoalAnalysis>();

function analyseGoal(v: Variant, goal: number): GoalAnalysis {
  const cacheKey = `${v.balls}:${goal}`;
  const cached = analyses.get(cacheKey);
  if (cached) return cached;
  const { states, adj } = graphFor(v);
  const n = states.length;
  // Moves are reversible, so distance to the goal is BFS from the goal.
  const dist = new Int16Array(n).fill(-1);
  const order = [goal];
  dist[goal] = 0;
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    for (const m of adj[s]) {
      if (dist[m.to] < 0) {
        dist[m.to] = dist[s] + 1;
        order.push(m.to);
      }
    }
  }
  const home = new Map<number, string>();
  states[goal].forEach((peg, p) => peg.forEach((ball, h) => home.set(ball, `${p}:${h}`)));
  // BFS order is non-decreasing in distance, so successors on a shortest path are already solved.
  const detour = new Int16Array(n).fill(0);
  for (const s of order) {
    if (s === goal) continue;
    let best = Infinity;
    for (const m of adj[s]) {
      if (dist[m.to] !== dist[s] - 1) continue;
      const cost = (home.get(m.ball) === `${m.peg}:${m.height}` ? 0 : 1) + detour[m.to];
      if (cost < best) best = cost;
    }
    detour[s] = best;
  }
  const a = { dist, detour };
  analyses.set(cacheKey, a);
  return a;
}

/** Largest minimum-move distance between any two states of a variant. */
export function towerDiameter(balls: 3 | 4): number {
  const v = VARIANTS[balls];
  const { states } = graphFor(v);
  let max = 0;
  for (let g = 0; g < states.length; g++) {
    for (const d of analyseGoal(v, g).dist) if (d > max) max = d;
  }
  return max;
}

/** Count of ordered (start, goal) pairs by `${minMoves}:${detourMoves}`. */
export function towerProfile(balls: 3 | 4): Map<string, number> {
  const v = VARIANTS[balls];
  const { states } = graphFor(v);
  const counts = new Map<string, number>();
  for (let g = 0; g < states.length; g++) {
    const { dist, detour } = analyseGoal(v, g);
    for (let s = 0; s < states.length; s++) {
      if (s === g) continue;
      const k = `${dist[s]}:${detour[s]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Goal hierarchy is ambiguous when the goal spreads over two or more pegs and some
 * goal ball rests on a ball that is not already in its goal place at the start,
 * so the order of placement must be worked out rather than read off one tower.
 */
export function goalAmbiguous(start: Pegs, goal: Pegs): boolean {
  if (goal.filter((p) => p.length > 0).length < 2) return false;
  return goal.some((peg, p) => peg.some((_, h) => h > 0 && start[p][h - 1] !== peg[h - 1]));
}

interface TowerLevel {
  level: number;
  balls: 3 | 4;
  moves: [number, number];
  detour: [number, number];
}

/*
 * State-space maxima (towerDiameter): 3 balls on pegs [3,2,1] reach at most 8
 * minimum moves; 4 balls on pegs [4,3,2,1] reach at most 9, because the extra
 * room makes the larger puzzle shallower. The design table's L8 (10–11 moves)
 * and L9 (12+ moves, ≥4 detours) are unreachable, so the 4-ball levels are
 * re-spread over what exists, each asking for the most detours available at its
 * move count (ordered-pair counts from towerProfile(4) in brackets):
 *   L6  6–7 moves, ≥2 detours   (≈73k pairs)
 *   L7  7 moves,   ≥3 detours   (12 792)
 *   L8  8 moves,   ≥4 detours   (768; every 8-move pair has exactly 4)
 *   L9  9 moves,   ≥5 detours   (24; the variant maximum, all with 5 detours)
 */
const TOWER_CONFIG: TowerLevel[] = [
  { level: 1, balls: 3, moves: [2, 2], detour: [0, 0] },
  { level: 2, balls: 3, moves: [3, 3], detour: [0, 0] },
  { level: 3, balls: 3, moves: [4, 4], detour: [1, 99] },
  { level: 4, balls: 3, moves: [5, 5], detour: [1, 99] },
  { level: 5, balls: 3, moves: [6, 7], detour: [2, 99] },
  { level: 6, balls: 4, moves: [6, 7], detour: [2, 99] },
  { level: 7, balls: 4, moves: [7, 7], detour: [3, 99] },
  { level: 8, balls: 4, moves: [8, 8], detour: [4, 99] },
  { level: 9, balls: 4, moves: [9, 99], detour: [5, 99] },
];

export interface TowerContent {
  capacities: number[];
  start: number[][];
  goal: number[][];
}

export function generateTower(
  level: number,
  rng: Rng,
): { start: Pegs; goal: Pegs; capacities: number[]; minMoves: number; detourMoves: number; goalAmbiguity: boolean } {
  const spec = TOWER_CONFIG.find((l) => l.level === level);
  if (!spec) throw new Error(`tower: unknown level ${level}`);
  const v = VARIANTS[spec.balls];
  const { states } = graphFor(v);
  const inBand = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;
  for (let attempt = 0; attempt < 400; attempt++) {
    const goal = rng.int(0, states.length - 1);
    const { dist, detour } = analyseGoal(v, goal);
    const fits: number[] = [];
    for (let s = 0; s < states.length; s++) if (inBand(dist[s], spec.moves) && inBand(detour[s], spec.detour)) fits.push(s);
    if (!fits.length) continue;
    const start = rng.pick(fits);
    const startPegs = states[start].map((p) => p.slice());
    const goalPegs = states[goal].map((p) => p.slice());
    return {
      start: startPegs,
      goal: goalPegs,
      capacities: v.capacities.slice(),
      minMoves: dist[start],
      detourMoves: detour[start],
      goalAmbiguity: goalAmbiguous(startPegs, goalPegs),
    };
  }
  throw new Error(`tower: could not generate level ${level}`);
}

export const TOWER_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.5, b: -1.6, c: 0, timeLimitMs: 60_000 },
  { level: 2, a: 1.5, b: -1.0, c: 0, timeLimitMs: 75_000 },
  { level: 3, a: 1.6, b: -0.3, c: 0, timeLimitMs: 90_000 },
  { level: 4, a: 1.6, b: 0.4, c: 0, timeLimitMs: 105_000 },
  { level: 5, a: 1.7, b: 1.1, c: 0, timeLimitMs: 120_000 },
  { level: 6, a: 1.7, b: 1.8, c: 0, timeLimitMs: 135_000 },
  { level: 7, a: 1.8, b: 2.5, c: 0, timeLimitMs: 150_000 },
  { level: 8, a: 1.9, b: 3.2, c: 0, timeLimitMs: 165_000 },
  { level: 9, a: 2.0, b: 3.7, c: 0, timeLimitMs: 180_000 },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const tower = generatorParadigm<TowerContent, number>({
  id: 'tower',
  version: 1,
  domain: 'executive',
  group: 'core',
  facet: 'planning',
  title: 'Planning',
  subtitle: 'Plan the moves. Count the fewest that reach the goal.',
  construct: 'Planning: looking ahead through a sequence of moves, including moves that lead away from the goal first.',
  instructions: [
    'Rearrange the balls from the start picture to the goal picture.',
    'A move takes the top ball of one peg and puts it on another peg that still has room.',
    'Work out the fewest moves needed and type that number.',
    'Plan it in your head; nothing on the screen moves.',
  ],
  minutes: 5,
  minRtMs: 2500,
  levels: TOWER_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const g = generateTower(level, rng);
    return {
      content: { capacities: g.capacities, start: g.start, goal: g.goal },
      key: g.minMoves,
      response: { kind: 'number', min: 1, max: 20 },
      features: {
        balls: g.start.flat().length,
        minMoves: g.minMoves,
        detourMoves: g.detourMoves,
        goalAmbiguity: g.goalAmbiguity,
      },
      explanation:
        `The goal takes at least ${plural(g.minMoves, 'move')}. ` +
        (g.detourMoves === 0
          ? 'Every ball can go straight to its final place.'
          : `${plural(g.detourMoves, 'move')} must put a ball somewhere other than its final place.`),
    };
  },
});
