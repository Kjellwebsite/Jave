/**
 * Standard competition ranking ("1224"): equal scores share a placement and
 * the next placement skips accordingly. Players missing from `scores` count
 * as 0. Output is ordered by placement, then player id, for stable display.
 */
export function rankPlacements(
  players: readonly string[],
  scores: Readonly<Record<string, number>>,
): { playerId: string; score: number; placement: number }[] {
  const sorted = players
    .map((playerId) => ({ playerId, score: scores[playerId] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  const out: { playerId: string; score: number; placement: number }[] = [];
  sorted.forEach((entry, index) => {
    const previous = out[index - 1];
    const placement = previous && previous.score === entry.score ? previous.placement : index + 1;
    out.push({ ...entry, placement });
  });
  return out;
}

/**
 * A win is first place in a ranked session with a positive score. Ties at
 * the top share the win; a result where the leaders scored nothing (nobody
 * answered, nobody tapped) has no winner, so idle sessions never farm wins.
 * The leaderboard's `wins` aggregate applies the same rule in SQL.
 */
export function isWin(standing: { placement: number; score: number }, ranked: boolean): boolean {
  return ranked && standing.placement === 1 && standing.score > 0;
}
