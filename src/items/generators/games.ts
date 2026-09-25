/**
 * Backward induction: subtraction games. Players alternate removing an allowed
 * number of tokens from one heap. Under normal play the player who makes the
 * last move wins (a player who cannot move loses); under misère play the player
 * who takes the last token loses. Positions are solved exactly: one heap by
 * dynamic programming over heap sizes, two heaps under normal play by
 * Sprague–Grundy values, two heaps under misère play by memoised search. Only
 * positions with exactly one winning move, or none, are used.
 */
import { generatorParadigm, type LevelSpec } from '../paradigm';
import type { Rng } from '../../utils/rng';

export interface GameMove {
  heap: number;
  take: number;
}

export interface GamesContent {
  heaps: number[];
  moves: number[];
  misere: boolean;
  options: { label: string; move: GameMove | null }[];
}

export const NO_WIN_LABEL = 'No move guarantees a win';
const HEAP_NAMES = ['A', 'B'];

/** Legal moves, heap by heap, smallest take first. */
export function legalMoves(heaps: number[], moves: number[]): GameMove[] {
  const sorted = moves.slice().sort((a, b) => a - b);
  return heaps.flatMap((h, heap) => sorted.filter((m) => m <= h).map((take) => ({ heap, take })));
}

const apply = (heaps: number[], { heap, take }: GameMove) => heaps.map((h, i) => (i === heap ? h - take : h));

/* ------------------------------------------------------------------ */
/* Exact solvers                                                        */
/* ------------------------------------------------------------------ */

/** win[n]: the player to move from a single heap of n wins. */
function singleHeapTable(max: number, moves: number[], misere: boolean): boolean[] {
  const win: boolean[] = [];
  for (let n = 0; n <= max; n++) {
    const legal = moves.filter((m) => m <= n);
    // No legal move: the opponent moved last (normal: lose; misère: win).
    win[n] = legal.length ? legal.some((m) => !win[n - m]) : misere;
  }
  return win;
}

function grundyTable(max: number, moves: number[]): number[] {
  const g: number[] = [];
  for (let n = 0; n <= max; n++) {
    const seen = new Set(moves.filter((m) => m <= n).map((m) => g[n - m]));
    let v = 0;
    while (seen.has(v)) v++;
    g[n] = v;
  }
  return g;
}

function misereTwoHeaps(moves: number[]): (a: number, b: number) => boolean {
  const memo = new Map<string, boolean>();
  const win = (a: number, b: number): boolean => {
    if (a > b) return win(b, a);
    const k = `${a},${b}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const legal = legalMoves([a, b], moves);
    const v = legal.length ? legal.some((m) => !win(...(apply([a, b], m) as [number, number]))) : true;
    memo.set(k, v);
    return v;
  };
  return win;
}

/** Exact win/loss for the player to move. */
export function solveGame(heaps: number[], moves: number[], misere: boolean): (pos: number[]) => boolean {
  const max = Math.max(...heaps);
  if (heaps.length === 1) {
    const win = singleHeapTable(max, moves, misere);
    return (pos) => win[pos[0]];
  }
  if (heaps.length !== 2) throw new Error('games: one or two heaps only');
  if (!misere) {
    const g = grundyTable(max, moves);
    return (pos) => (g[pos[0]] ^ g[pos[1]]) !== 0;
  }
  const win = misereTwoHeaps(moves);
  return (pos) => win(pos[0], pos[1]);
}

/** Moves that leave the opponent in a lost position. */
export function winningMoves(heaps: number[], moves: number[], misere: boolean): GameMove[] {
  const isWin = solveGame(heaps, moves, misere);
  return legalMoves(heaps, moves).filter((m) => !isWin(apply(heaps, m)));
}

/**
 * Remoteness: the length of the game under optimal play, where the winner
 * finishes as fast as possible and the loser holds out as long as possible.
 */
export function gameDepth(heaps: number[], moves: number[], misere: boolean): number {
  const isWin = solveGame(heaps, moves, misere);
  const memo = new Map<string, number>();
  const depth = (pos: number[]): number => {
    const k = pos.join(',');
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const legal = legalMoves(pos, moves);
    let d = 0;
    if (legal.length) {
      const children = legal.map((m) => apply(pos, m));
      d = isWin(pos)
        ? 1 + Math.min(...children.filter((c) => !isWin(c)).map(depth))
        : 1 + Math.max(...children.map(depth));
    }
    memo.set(k, d);
    return d;
  };
  return depth(heaps);
}

/* ------------------------------------------------------------------ */
/* Levels                                                               */
/* ------------------------------------------------------------------ */

interface GamesLevel {
  level: number;
  heaps: 1 | 2;
  sets: number[][];
  misere: boolean;
  /**
   * Heap-size range. One heap: the heap. Two heaps: the larger heap; the smaller
   * heap is drawn from 1 up to the larger one. The lower end is raised to max move + 2.
   */
  size: [number, number];
  /** Share of lost positions (key: "No move guarantees a win"). */
  losing: number;
}

const IRREGULAR = [
  [1, 3, 4],
  [1, 4, 5],
  [2, 3, 5],
  [1, 2, 6],
  [1, 2, 5],
  [1, 3, 6],
];
/** Misère sets contain 1, so a game always ends by someone taking the last token. */
const IRREGULAR_MISERE = IRREGULAR.filter((s) => s.includes(1));

/*
 * Two-heap levels deviate from the design table. With {1, 2, 3} (or any set whose
 * Grundy values cycle through every residue) each heap of 3+ tokens can reach any
 * target value, so a won position almost always has two winning moves (one per
 * heap) and fails the one-winning-move rule. L6 therefore uses the irregular sets
 * with the most positions that have one winning move and short Grundy periods,
 * with smaller heaps; L7 and L8 use sets whose largest move is 5–6. Requiring both
 * heaps ≥ max move + 2 leaves almost no one-winner positions, so the rule applies
 * to the larger heap only.
 */
const TWO_HEAP_EASY = [
  [1, 3, 4],
  [2, 3, 5],
  [1, 4, 5],
];
const TWO_HEAP_HARD = [
  [1, 2, 6],
  [1, 3, 6],
  [2, 3, 6],
  [2, 4, 5],
  [1, 4, 6],
];
const TWO_HEAP_MISERE = [
  [1, 3, 4],
  [1, 4, 5],
  [1, 2, 6],
  [1, 3, 6],
  [1, 4, 6],
];

const GAMES_CONFIG: GamesLevel[] = [
  { level: 1, heaps: 1, sets: [[1, 2]], misere: false, size: [4, 6], losing: 0.2 },
  { level: 2, heaps: 1, sets: [[1, 2, 3]], misere: false, size: [7, 11], losing: 0.2 },
  { level: 3, heaps: 1, sets: IRREGULAR, misere: false, size: [8, 14], losing: 0.25 },
  { level: 4, heaps: 1, sets: IRREGULAR, misere: false, size: [15, 24], losing: 0.25 },
  { level: 5, heaps: 1, sets: IRREGULAR_MISERE, misere: true, size: [10, 18], losing: 0.25 },
  { level: 6, heaps: 2, sets: TWO_HEAP_EASY, misere: false, size: [6, 10], losing: 0.25 },
  { level: 7, heaps: 2, sets: TWO_HEAP_HARD, misere: false, size: [7, 14], losing: 0.25 },
  { level: 8, heaps: 2, sets: TWO_HEAP_MISERE, misere: true, size: [7, 14], losing: 0.25 },
];

const moveLabel = (m: GameMove, heaps: number) => (heaps === 1 ? `Take ${m.take}` : `Take ${m.take} from heap ${HEAP_NAMES[m.heap]}`);

export function generateGame(
  level: number,
  rng: Rng,
): { content: GamesContent; key: number; winning: GameMove | null; depth: number } {
  const spec = GAMES_CONFIG.find((l) => l.level === level);
  if (!spec) throw new Error(`games: unknown level ${level}`);
  const wantLost = rng.chance(spec.losing);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const moves = rng.pick(spec.sets);
    const lo = Math.max(spec.size[0], Math.max(...moves) + 2);
    if (lo > spec.size[1]) continue;
    const big = rng.int(lo, spec.size[1]);
    const heaps = spec.heaps === 1 ? [big] : rng.shuffle([big, rng.int(1, big)]);
    const win = winningMoves(heaps, moves, spec.misere);
    if (wantLost ? win.length !== 0 : win.length !== 1) continue;
    const legal = legalMoves(heaps, moves);
    const options = [...legal.map((m) => ({ label: moveLabel(m, heaps.length), move: m })), { label: NO_WIN_LABEL, move: null }];
    const key = wantLost ? options.length - 1 : legal.findIndex((m) => m.heap === win[0].heap && m.take === win[0].take);
    return {
      content: { heaps, moves: moves.slice(), misere: spec.misere, options },
      key,
      winning: wantLost ? null : win[0],
      depth: gameDepth(heaps, moves, spec.misere),
    };
  }
  throw new Error(`games: could not generate level ${level}`);
}

export const GAMES_LEVELS: LevelSpec[] = [
  { level: 1, a: 1.4, b: -1.4, c: 0.33, timeLimitMs: 60_000 },
  { level: 2, a: 1.5, b: -0.6, c: 0.25, timeLimitMs: 60_000 },
  { level: 3, a: 1.5, b: 0.3, c: 0.25, timeLimitMs: 75_000 },
  { level: 4, a: 1.6, b: 1.0, c: 0.25, timeLimitMs: 90_000 },
  { level: 5, a: 1.6, b: 1.7, c: 0.25, timeLimitMs: 105_000 },
  { level: 6, a: 1.7, b: 2.4, c: 0.17, timeLimitMs: 120_000 },
  { level: 7, a: 1.7, b: 3.0, c: 0.17, timeLimitMs: 135_000 },
  { level: 8, a: 1.8, b: 3.6, c: 0.17, timeLimitMs: 150_000 },
];

export const games = generatorParadigm<GamesContent, number>({
  id: 'games',
  version: 1,
  domain: 'strategic',
  group: 'core',
  facet: 'backward-induction',
  title: 'Backward induction',
  subtitle: 'Think from the end of the game. Find the winning move.',
  construct: 'Strategic look-ahead: reasoning backwards from the end of a two-player game to the move that forces a win.',
  instructions: [
    'Two players take turns removing tokens from one heap, and each move must remove one of the allowed amounts.',
    'In a normal game the player who makes the last move wins, so a player who cannot move loses.',
    'In a misère game the player who takes the last token loses.',
    'It is your move against a perfect opponent: pick the move that guarantees a win, or say that none does.',
  ],
  minutes: 5,
  minRtMs: 3000,
  levels: GAMES_LEVELS,
  practiceLevels: [1, 2],
  generate(level, rng) {
    const { content, key, winning, depth } = generateGame(level, rng);
    return {
      content,
      key,
      response: { kind: 'choice', options: content.options.length },
      features: {
        heaps: content.heaps.join(','),
        moveSet: content.moves.join(','),
        misere: content.misere,
        depth,
        lost: winning === null,
        options: content.options.length,
      },
      explanation: winning
        ? `${content.options[key].label} leaves a position in which every reply loses against best play.`
        : 'Every move leaves the opponent a reply that wins, so no move guarantees a win.',
    };
  },
});
