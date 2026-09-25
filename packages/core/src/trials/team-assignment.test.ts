import { describe, expect, it } from 'vitest';
import {
  type AssignmentCandidate,
  createRng,
  planTeams,
  planTeamSizes,
  seededShuffle,
  teamName,
} from './team-assignment';

const DOMAINS = ['mind', 'create', 'body', 'life', 'bio'] as const;

function candidates(count: number, domains: readonly (string | null)[] = DOMAINS) {
  return Array.from({ length: count }, (_, i): AssignmentCandidate => ({
    memberId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    primaryDomain: domains[i % domains.length] ?? null,
    leadPriority: 0,
  }));
}

describe('planTeamSizes', () => {
  it.each([
    [0, 3, []],
    [1, 3, [1]],
    [2, 3, [2]],
    [3, 3, [3]],
    [4, 3, [4]],
    [5, 3, [3, 2]],
    [6, 3, [3, 3]],
    [7, 3, [4, 3]],
    [10, 3, [4, 3, 3]],
    [11, 4, [4, 4, 3]],
    [12, 4, [4, 4, 4]],
    [5, 1, [1, 1, 1, 1, 1]],
    [9, 12, [9]],
  ])('%i members at size %i → %j', (count, size, expected) => {
    expect(planTeamSizes(count, size)).toEqual(expected);
  });

  it('always accounts for every member, sizes differ by at most one, larger teams first', () => {
    for (let count = 1; count <= 60; count++) {
      for (let size = 1; size <= 12; size++) {
        const sizes = planTeamSizes(count, size);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(count);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
      }
    }
  });

  it('rejects a team size below one', () => {
    expect(() => planTeamSizes(4, 0)).toThrow(RangeError);
  });
});

describe('teamName', () => {
  it('uses the NATO alphabet, then numbered cycles', () => {
    expect(teamName(0)).toBe('UNIT ALPHA');
    expect(teamName(1)).toBe('UNIT BRAVO');
    expect(teamName(25)).toBe('UNIT ZULU');
    expect(teamName(26)).toBe('UNIT ALPHA 2');
    expect(teamName(53)).toBe('UNIT BRAVO 3');
  });
});

describe('seeded randomness', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const c = createRng('seed-2');
    const seqA = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(seqA);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('shuffles without losing or mutating items', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = seededShuffle(items, createRng('x'));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(items[0]).toBe(0);
    expect(shuffled).not.toEqual(items);
  });
});

describe('planTeams', () => {
  it('returns no teams for no candidates', () => {
    expect(planTeams([], { teamSize: 3, strategy: 'random', seed: 's' })).toEqual([]);
  });

  it('puts a single candidate in one team as lead', () => {
    const [one] = candidates(1);
    const teams = planTeams([one!], { teamSize: 3, strategy: 'balanced', seed: 's' });
    expect(teams).toEqual([
      { ordinal: 0, name: 'UNIT ALPHA', leadMemberId: one!.memberId, memberIds: [one!.memberId] },
    ]);
  });

  it('forms one team when there are fewer candidates than the team size', () => {
    const teams = planTeams(candidates(2), { teamSize: 5, strategy: 'random', seed: 's' });
    expect(teams).toHaveLength(1);
    expect(teams[0]!.memberIds).toHaveLength(2);
  });

  it('sizes teams by planTeamSizes and assigns everyone exactly once', () => {
    for (const strategy of ['random', 'balanced'] as const) {
      const pool = candidates(17);
      const teams = planTeams(pool, { teamSize: 4, strategy, seed: 'abc' });
      expect(teams.map((t) => t.memberIds.length)).toEqual(planTeamSizes(17, 4));
      const all = teams.flatMap((t) => t.memberIds);
      expect(new Set(all).size).toBe(17);
      expect(all.sort()).toEqual(pool.map((c) => c.memberId).sort());
      expect(teams.map((t) => t.name)).toEqual([
        'UNIT ALPHA',
        'UNIT BRAVO',
        'UNIT CHARLIE',
        'UNIT DELTA',
      ]);
    }
  });

  it('is deterministic given the seed, regardless of input order', () => {
    const pool = candidates(13);
    const options = { teamSize: 3, strategy: 'balanced' as const, seed: 'fixed' };
    const a = planTeams(pool, options);
    const b = planTeams([...pool].reverse(), options);
    expect(b).toEqual(a);
    const c = planTeams(pool, { ...options, seed: 'other' });
    expect(c).not.toEqual(a);
  });

  it('balanced spreads every primary domain evenly across teams', () => {
    const skewed = [
      ...candidates(9, ['create']),
      ...candidates(3, ['mind']).map((c, i) => ({ ...c, memberId: `m-${i}` })),
      ...candidates(3, [null]).map((c, i) => ({ ...c, memberId: `u-${i}` })),
    ];
    for (const seed of ['a', 'b', 'c', 'd']) {
      const teams = planTeams(skewed, { teamSize: 5, strategy: 'balanced', seed });
      const domainOf = new Map(skewed.map((c) => [c.memberId, c.primaryDomain ?? 'unknown']));
      for (const domain of ['create', 'mind', 'unknown']) {
        const counts = teams.map(
          (t) => t.memberIds.filter((id) => domainOf.get(id) === domain).length,
        );
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('prefers higher lead priority, otherwise the first dealt member', () => {
    const pool = candidates(6).map((c, i) => ({ ...c, leadPriority: i === 4 ? 1 : 0 }));
    const teams = planTeams(pool, { teamSize: 6, strategy: 'random', seed: 'lead' });
    expect(teams).toHaveLength(1);
    expect(teams[0]!.leadMemberId).toBe(pool[4]!.memberId);
    expect(teams[0]!.memberIds[0]).toBe(pool[4]!.memberId);
  });

  it('rejects duplicate candidates', () => {
    const [one] = candidates(1);
    expect(() => planTeams([one!, one!], { teamSize: 2, strategy: 'random', seed: 's' })).toThrow(
      RangeError,
    );
  });
});
