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
