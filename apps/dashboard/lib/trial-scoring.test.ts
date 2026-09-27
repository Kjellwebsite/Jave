import { describe, expect, it } from 'vitest';
import { scoreTargets } from './trial-scoring';

const VIEWER = { userId: 'user-evaluator', memberId: 'member-evaluator' };

function team(overrides: Partial<Parameters<typeof scoreTargets>[0]> = {}) {
  return {
    id: 'team-1',
    name: 'UNIT ALPHA',
    members: [
      { memberId: 'member-a', displayName: 'Ada', handle: 'ada', role: 'lead' as const },
      { memberId: 'member-b', displayName: 'Bram', handle: 'bram', role: 'member' as const },
    ],
    submissions: [
      {
        version: 1,
        summary: 'Shipped.',
        links: [],
        isLate: false,
        submittedAt: new Date(0),
        submittedBy: 'Ada',
      },
    ],
    evaluations: [],
    ...overrides,
  };
}

describe('scoreTargets mirrors the trials service', () => {
  it('a submitting team: the team, then each member, with the viewer’s earlier scores', () => {
    const targets = scoreTargets(
      team({
        evaluations: [
          { evaluatorUserId: VIEWER.userId, memberId: null, scores: { impact: 7 }, notes: 'ok' },
          {
            evaluatorUserId: 'someone-else',
            memberId: 'member-a',
            scores: { impact: 3 },
            notes: null,
          },
        ],
      }),
      VIEWER,
    );
    expect(targets.map((target) => target.value)).toEqual([
      'team:team-1',
      'member:member-a',
      'member:member-b',
    ]);
    expect(targets[0]!.previous).toEqual({ scores: { impact: 7 }, notes: 'ok' });
    // Another evaluator's score is never prefilled as the viewer's.
    expect(targets[1]!.previous).toBeNull();
  });

  it('BREAK: a team that never submitted offers nothing to score (the service refuses it)', () => {
    expect(scoreTargets(team({ submissions: [] }), VIEWER)).toEqual([]);
  });

  it('BREAK: the viewer is never offered as their own target', () => {
    const targets = scoreTargets(team(), { userId: 'user-a', memberId: 'member-a' });
    expect(targets.map((target) => target.value)).toEqual(['team:team-1', 'member:member-b']);
  });
});
