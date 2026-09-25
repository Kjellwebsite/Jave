import { describe, expect, it } from 'vitest';
import { generateTower, tower, TOWER_LEVELS, towerDiameter } from '../src/items/generators/tower';
import { games, GAMES_LEVELS, generateGame, NO_WIN_LABEL } from '../src/items/generators/games';
import { createRng } from '../src/utils/rng';

const SEEDS = 40;

/* ------------------------------------------------------------------ */
/* Tower: independent search                                            */
/* ------------------------------------------------------------------ */

type Pegs = number[][];
const enc = (p: Pegs) => JSON.stringify(p);

function successors(p: Pegs, caps: number[]): { next: Pegs; ball: number; peg: number; height: number }[] {
  const out: { next: Pegs; ball: number; peg: number; height: number }[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i].length === 0) continue;
    for (let j = 0; j < p.length; j++) {
      if (j === i || p[j].length >= caps[j]) continue;
      const next = p.map((x) => [...x]);
      const ball = next[i].pop()!;
      next[j].push(ball);
      out.push({ next, ball, peg: j, height: p[j].length });
    }
  }
  return out;
}

function bfs(start: Pegs, caps: number[]): Map<string, number> {
  const dist = new Map([[enc(start), 0]]);
  let frontier = [start];
  while (frontier.length) {
    const nextFrontier: Pegs[] = [];
    for (const s of frontier) {
      for (const { next } of successors(s, caps)) {
        const k = enc(next);
        if (!dist.has(k)) {
          dist.set(k, dist.get(enc(s))! + 1);
          nextFrontier.push(next);
        }
      }
    }
    frontier = nextFrontier;
  }
  return dist;
}

/** Fewest detour moves over all shortest paths, by memoised recursion from the start. */
function minDetours(start: Pegs, goal: Pegs, caps: number[]): number {
  const toGoal = bfs(goal, caps);
  const memo = new Map<string, number>();
  const rec = (s: Pegs): number => {
    const k = enc(s);
    if (k === enc(goal)) return 0;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const d = toGoal.get(k)!;
    let best = Infinity;
    for (const { next, ball, peg, height } of successors(s, caps)) {
      if (toGoal.get(enc(next)) !== d - 1) continue;
      const direct = goal[peg][height] === ball;
      best = Math.min(best, (direct ? 0 : 1) + rec(next));
    }
    memo.set(k, best);
    return best;
  };
  return rec(start);
}

const TOWER_BANDS: Record<number, { balls: number; moves: [number, number]; detour: [number, number] }> = {
  1: { balls: 3, moves: [2, 2], detour: [0, 0] },
  2: { balls: 3, moves: [3, 3], detour: [0, 0] },
  3: { balls: 3, moves: [4, 4], detour: [1, 99] },
  4: { balls: 3, moves: [5, 5], detour: [1, 99] },
  5: { balls: 3, moves: [6, 7], detour: [2, 99] },
  6: { balls: 4, moves: [6, 7], detour: [2, 99] },
  7: { balls: 4, moves: [7, 7], detour: [3, 99] },
  8: { balls: 4, moves: [8, 8], detour: [4, 99] },
  9: { balls: 4, moves: [9, 9], detour: [5, 99] },
};

describe('tower generator', () => {
  it('state-space maxima: 8 moves with 3 balls, 9 with 4 balls', () => {
    expect(towerDiameter(3)).toBe(8);
    expect(towerDiameter(4)).toBe(9);
  });

  it('keys the minimum number of moves, verified by independent BFS', () => {
    for (const { level } of TOWER_LEVELS) {
      const band = TOWER_BANDS[level];
      for (let s = 0; s < SEEDS; s++) {
        const g = generateTower(level, createRng(level * 1000 + s));
        const caps = band.balls === 3 ? [3, 2, 1] : [4, 3, 2, 1];
        expect(g.capacities).toEqual(caps);
        for (const pegs of [g.start, g.goal]) {
          expect(pegs).toHaveLength(caps.length);
          pegs.forEach((p, i) => expect(p.length).toBeLessThanOrEqual(caps[i]));
          expect(pegs.flat().sort()).toEqual(Array.from({ length: band.balls }, (_, i) => i));
        }
        expect(enc(g.start)).not.toBe(enc(g.goal));
        const d = bfs(g.start, caps).get(enc(g.goal));
        expect(d).toBe(g.minMoves);
        expect(g.minMoves).toBeGreaterThanOrEqual(band.moves[0]);
        expect(g.minMoves).toBeLessThanOrEqual(band.moves[1]);
        const det = minDetours(g.start, g.goal, caps);
        expect(det).toBe(g.detourMoves);
        expect(det).toBeGreaterThanOrEqual(band.detour[0]);
        expect(det).toBeLessThanOrEqual(band.detour[1]);
      }
    }
  });

  it('builds items through the paradigm with a numeric key', () => {
    for (const { level } of TOWER_LEVELS) {
      const item = tower.instantiate(String(level), createRng(9000 + level));
      const again = tower.instantiate(String(level), createRng(9000 + level));
      expect(item.id).toBe(again.id);
      expect(item.response).toEqual({ kind: 'number', min: 1, max: 20 });
      expect(item.irt.c).toBe(0);
      expect(tower.score(item, { kind: 'number', value: item.key as number }).correct).toBe(true);
      expect(tower.score(item, { kind: 'number', value: (item.key as number) + 1 }).correct).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Games: independent brute-force game tree                             */
/* ------------------------------------------------------------------ */

function bruteWins(heaps: number[], moves: number[], misere: boolean, memo = new Map<string, boolean>()): boolean {
  const k = heaps.join(',');
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  let anyMove = false;
  let win = false;
  for (let h = 0; h < heaps.length && !win; h++) {
    for (const m of moves) {
      if (m > heaps[h]) continue;
      anyMove = true;
      const child = heaps.slice();
      child[h] -= m;
      if (!bruteWins(child, moves, misere, memo)) {
        win = true;
        break;
      }
    }
  }
  // No move: under normal play the mover loses; under misère the opponent took the last token.
  const v = anyMove ? win : misere;
  memo.set(k, v);
  return v;
}

describe('games generator', () => {
  it('keys the unique winning move, verified by brute-force game-tree search', () => {
    for (const { level } of GAMES_LEVELS) {
      let lost = 0;
      const n = level >= 3 ? 200 : SEEDS;
      for (let s = 0; s < n; s++) {
        const { content, key, depth } = generateGame(level, createRng(level * 1000 + s));
        const { heaps, moves, misere, options } = content;
        if (misere) expect(moves).toContain(1);
        expect(Math.max(...heaps)).toBeGreaterThanOrEqual(Math.max(...moves) + 2);
        // Options are every legal move plus the final "no move" option.
        const legal = heaps.flatMap((h, i) => moves.filter((m) => m <= h).map((m) => `${i}:${m}`));
        expect(options.slice(0, -1).map((o) => `${o.move!.heap}:${o.move!.take}`).sort()).toEqual(legal.sort());
        expect(options[options.length - 1]).toEqual({ label: NO_WIN_LABEL, move: null });
        expect(new Set(options.map((o) => o.label)).size).toBe(options.length);
        const memo = new Map<string, boolean>();
        const winners = options
          .map((o, i) => ({ o, i }))
          .filter(({ o }) => o.move && !bruteWins(heaps.map((h, j) => (j === o.move!.heap ? h - o.move!.take : h)), moves, misere, memo));
        expect(winners.length).toBeLessThanOrEqual(1);
        const rootWins = bruteWins(heaps, moves, misere, memo);
        expect(rootWins).toBe(winners.length === 1);
        expect(key).toBe(winners.length ? winners[0].i : options.length - 1);
        // Remoteness parity: the winner makes the last move (normal) or leaves the last token to the loser (misère).
        expect(depth).toBeGreaterThanOrEqual(1);
        expect(misere ? depth % 2 === 0 : depth % 2 === 1).toBe(rootWins);
        if (!rootWins) lost++;
      }
      if (level >= 3) {
        expect(lost / n).toBeGreaterThanOrEqual(0.15);
        expect(lost / n).toBeLessThanOrEqual(0.35);
      }
    }
  });

  it('labels moves by heap only when there are two heaps', () => {
    const one = generateGame(3, createRng(1)).content;
    expect(one.options[0].label).toMatch(/^Take \d+$/);
    const two = generateGame(7, createRng(1)).content;
    expect(two.options[0].label).toMatch(/^Take \d+ from heap [AB]$/);
  });

  it('builds items through the paradigm with a choice key', () => {
    for (const { level } of GAMES_LEVELS) {
      const item = games.instantiate(String(level), createRng(9000 + level));
      const c = item.content as { options: unknown[] };
      expect(item.response).toEqual({ kind: 'choice', options: c.options.length });
      expect(games.score(item, { kind: 'choice', index: item.key as number }).correct).toBe(true);
    }
  });
});
