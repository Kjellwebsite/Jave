import { createRng } from '../games/rng';

/**
 * Deterministic random teams. Input order does not matter (ids are sorted
 * first), so the same members and seed always give the same teams. Members
 * are dealt round-robin: team sizes differ by at most one.
 */
export function drawTeams(
  memberIds: readonly string[],
  teamSize: number,
  seed: string,
): string[][] {
  if (!Number.isInteger(teamSize) || teamSize < 1) throw new RangeError('teamSize must be ≥ 1');
  if (memberIds.length === 0) return [];
  const shuffled = createRng(seed).shuffle([...new Set(memberIds)].sort());
  const teamCount = Math.ceil(shuffled.length / teamSize);
  const teams: string[][] = Array.from({ length: teamCount }, () => []);
  shuffled.forEach((memberId, index) => teams[index % teamCount]!.push(memberId));
  return teams;
}

/** "Team 01", "Team 02", … skipping names already taken for the event. */
export function nextTeamNames(prefix: string, count: number, taken: ReadonlySet<string>): string[] {
  const names: string[] = [];
  const width = Math.max(2, String(taken.size + count).length);
  for (let n = 1; names.length < count; n++) {
    const name = `${prefix} ${String(n).padStart(width, '0')}`;
    if (!taken.has(name)) names.push(name);
  }
  return names;
}
