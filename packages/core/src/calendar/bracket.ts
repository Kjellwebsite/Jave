/**
 * Pure single-elimination bracket generation.
 *
 * The bracket size is the next power of two ≥ the team count; the missing
 * slots are byes. Standard seeding places seed 1 and seed 2 in opposite
 * halves and pairs byes with the top seeds, so a bye never meets a bye and
 * top seeds meet as late as possible. Round 1 byes are resolved immediately:
 * the present team advances into round 2.
 */

export type BracketSlotName = 'a' | 'b';
export type PlannedMatchStatus = 'pending' | 'ready' | 'bye';

export interface MatchRef {
  round: number;
  position: number;
}

export interface PlannedMatch extends MatchRef {
  teamA: string | null;
  teamB: string | null;
  status: PlannedMatchStatus;
  winner: string | null;
  next: (MatchRef & { slot: BracketSlotName }) | null;
}

export interface BracketPlan {
  /** Power of two ≥ team count. */
  size: number;
  rounds: number;
  byes: number;
  /** Ordered by round, then position. */
  matches: PlannedMatch[];
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** Seeds (1-based) in bracket slot order, e.g. size 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedOrder(size: number): number[] {
  if (size < 1 || nextPowerOfTwo(size) !== size)
    throw new RangeError('size must be a power of two');
  let order = [1];
  while (order.length < size) {
    const width = order.length * 2;
    order = order.flatMap((seed) => [seed, width + 1 - seed]);
  }
  return order;
}

/** Where the winner of (round, position) plays next; null for the final. */
export function nextMatchRef(
  round: number,
  position: number,
  rounds: number,
): (MatchRef & { slot: BracketSlotName }) | null {
  if (round >= rounds) return null;
  return {
    round: round + 1,
    position: Math.floor(position / 2),
    slot: position % 2 === 0 ? 'a' : 'b',
  };
}

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
}

function key(ref: MatchRef): string {
  return `${ref.round}:${ref.position}`;
}

/**
 * Build the bracket for teams listed strongest first (index 0 = seed 1).
 * Throws on fewer than two teams or duplicate ids.
 */
export function buildSingleElimination(teamsBySeed: readonly string[]): BracketPlan {
  if (teamsBySeed.length < 2) throw new RangeError('a bracket needs at least two teams');
  if (new Set(teamsBySeed).size !== teamsBySeed.length) throw new RangeError('duplicate team');
  const size = nextPowerOfTwo(teamsBySeed.length);
  const rounds = Math.log2(size);
  const slots = seedOrder(size).map((seed) => teamsBySeed[seed - 1] ?? null);

  const matches = new Map<string, PlannedMatch>();
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position++) {
      const match: PlannedMatch = {
        round,
        position,
        teamA: round === 1 ? slots[position * 2]! : null,
        teamB: round === 1 ? slots[position * 2 + 1]! : null,
        status: 'pending',
        winner: null,
        next: nextMatchRef(round, position, rounds),
      };
      matches.set(key(match), match);
    }
  }

  for (const match of matches.values()) {
    if (match.round !== 1) continue;
    if (match.teamA && match.teamB) {
      match.status = 'ready';
      continue;
    }
    const present = match.teamA ?? match.teamB;
    if (!present) throw new Error('invariant: a bye met a bye');
    match.status = 'bye';
    match.winner = present;
    const next = matches.get(key(match.next!))!;
    if (match.next!.slot === 'a') next.teamA = present;
    else next.teamB = present;
  }
  for (const match of matches.values()) {
    if (match.round > 1 && match.teamA && match.teamB) match.status = 'ready';
  }

  return {
    size,
    rounds,
    byes: size - teamsBySeed.length,
    matches: [...matches.values()].sort((x, y) => x.round - y.round || x.position - y.position),
  };
}

export interface MatchScore {
  scoreA: number | null;
  scoreB: number | null;
  winner?: BracketSlotName;
}

/**
 * Decide the winning slot. Scores decide unless tied; a tie or a forfeit
 * (no scores) needs an explicit winner, and an explicit winner must agree
 * with the scores. Returns an error message instead of throwing.
 */
export function decideWinner(score: MatchScore): { slot: BracketSlotName } | { error: string } {
  const { scoreA, scoreB, winner } = score;
  if (scoreA === null || scoreB === null) {
    return winner ? { slot: winner } : { error: 'A forfeit needs an explicit winner.' };
  }
  if (scoreA === scoreB) {
    return winner ? { slot: winner } : { error: 'Tied score: name the winner of the tiebreak.' };
  }
  const byScore: BracketSlotName = scoreA > scoreB ? 'a' : 'b';
  if (winner && winner !== byScore) return { error: 'The winner does not match the score.' };
  return { slot: byScore };
}
