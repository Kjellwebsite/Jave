import { describe, expect, it } from 'vitest';
import {
  computeResults,
  mean,
  outcomeFor,
  recommendRank,
  roundScore,
  weightedScore,
} from './scoring';

const RUBRIC = [
  { key: 'shipped', weight: 3 },
  { key: 'value', weight: 1 },
];
const THRESHOLDS = { passThreshold: 6, distinctionThreshold: 8.5 };

describe('weightedScore', () => {
  it('computes the weighted mean with relative weights', () => {
    expect(weightedScore(RUBRIC, { shipped: 8, value: 4 })).toBe(7);
    expect(
      weightedScore(
        [
          { key: 'a', weight: 35 },
          { key: 'b', weight: 65 },
        ],
        { a: 10, b: 0 },
      ),
    ).toBe(3.5);
  });

  it('rounds to two decimals', () => {
    expect(
      weightedScore(
        [
          { key: 'a', weight: 1 },
          { key: 'b', weight: 1 },
          { key: 'c', weight: 1 },
        ],
        { a: 7, b: 7, c: 8 },
      ),
    ).toBe(7.33);
  });

  it('BREAK: refuses missing or out-of-range scores', () => {
    expect(() => weightedScore(RUBRIC, { shipped: 8 })).toThrow(RangeError);
    expect(() => weightedScore(RUBRIC, { shipped: 11, value: 1 })).toThrow(RangeError);
    expect(() => weightedScore(RUBRIC, { shipped: -1, value: 1 })).toThrow(RangeError);
    expect(() => weightedScore(RUBRIC, { shipped: Number.NaN, value: 1 })).toThrow(RangeError);
  });
});

describe('outcomes and ranks', () => {
  it('maps scores to outcomes at the thresholds', () => {
    expect(outcomeFor(8.5, THRESHOLDS)).toBe('distinction');
    expect(outcomeFor(8.49, THRESHOLDS)).toBe('pass');
    expect(outcomeFor(6, THRESHOLDS)).toBe('pass');
    expect(outcomeFor(5.99, THRESHOLDS)).toBe('fail');
  });

  it('treats a distinction threshold below the pass mark as the pass mark', () => {
    expect(outcomeFor(5, { passThreshold: 6, distinctionThreshold: 4 })).toBe('fail');
    expect(outcomeFor(6, { passThreshold: 6, distinctionThreshold: 4 })).toBe('distinction');
  });

  it('recommends ranks only for passing results and never S', () => {
    expect(recommendRank(10, 'distinction')).toBe('A');
    expect(recommendRank(9, 'distinction')).toBe('A');
    expect(recommendRank(8.99, 'distinction')).toBe('B');
    expect(recommendRank(7, 'pass')).toBe('C');
    expect(recommendRank(6.5, 'pass')).toBe('D');
    expect(recommendRank(5.5, 'pass')).toBe('E');
    expect(recommendRank(3, 'pass')).toBe('F');
    expect(recommendRank(9.9, 'fail')).toBeNull();
    expect(recommendRank(null, 'incomplete')).toBeNull();
  });

  it('mean and rounding helpers', () => {
    expect(mean([])).toBeNull();
    expect(mean([6, 8])).toBe(7);
    expect(roundScore(7.005)).toBeCloseTo(7.01, 2);
  });
});

describe('computeResults', () => {
  const base = {
    ...THRESHOLDS,
    teamWeight: 0.6,
    facetKey: 'create.projects',
    participants: [
      { memberId: 'a', teamId: 'T1' },
      { memberId: 'b', teamId: 'T1' },
      { memberId: 'c', teamId: 'T2' },
      { memberId: 'd', teamId: 'T3' },
    ],
    submittedTeamIds: new Set(['T1', 'T2', 'T3']),
  };

  it('team score is the mean of team evaluations; individual falls back to team', () => {
    const results = computeResults({
      ...base,
      evaluations: [
        { teamId: 'T1', memberId: null, overallScore: 7 },
        { teamId: 'T1', memberId: null, overallScore: 9 },
        { teamId: 'T1', memberId: 'a', overallScore: 10 },
      ],
    });
    const a = results.find((r) => r.memberId === 'a')!;
    const b = results.find((r) => r.memberId === 'b')!;
    expect(a.teamScore).toBe(8);
    expect(a.individualScore).toBe(10);
    expect(a.finalScore).toBe(8.8); // 0.6*8 + 0.4*10
    expect(a.outcome).toBe('distinction');
    expect(a.recommendedRank).toBe('B');
    expect(b.individualScore).toBe(8);
    expect(b.finalScore).toBe(8);
    expect(b.outcome).toBe('pass');
  });

  it('individual scores stand in when a team has no team evaluation', () => {
    const [c] = computeResults({
      ...base,
      participants: [{ memberId: 'c', teamId: 'T2' }],
      evaluations: [{ teamId: 'T2', memberId: 'c', overallScore: 5 }],
    });
    expect(c!.teamScore).toBeNull();
    expect(c!.individualScore).toBe(5);
    expect(c!.finalScore).toBe(5);
    expect(c!.outcome).toBe('fail');
    expect(c!.recommendedRank).toBeNull();
  });

  it('teams that never submitted are INCOMPLETE, whatever the evaluations say', () => {
    const results = computeResults({
      ...base,
      submittedTeamIds: new Set(['T1']),
      evaluations: [{ teamId: 'T3', memberId: 'd', overallScore: 10 }],
    });
    const d = results.find((r) => r.memberId === 'd')!;
    expect(d.outcome).toBe('incomplete');
    expect(d.incompleteReason).toBe('no_submission');
    expect(d.finalScore).toBeNull();
  });

  it('unevaluated participants are INCOMPLETE (never a fabricated fail)', () => {
    const results = computeResults({ ...base, evaluations: [] });
    expect(results.every((r) => r.outcome === 'incomplete')).toBe(true);
    expect(results.every((r) => r.incompleteReason === 'not_evaluated')).toBe(true);
  });

  it('team weight 1 ignores individuals; team weight 0 ignores the team', () => {
    const evaluations = [
      { teamId: 'T1', memberId: null, overallScore: 4 },
      { teamId: 'T1', memberId: 'a', overallScore: 10 },
    ];
    const participants = [{ memberId: 'a', teamId: 'T1' }];
    expect(
      computeResults({ ...base, participants, evaluations, teamWeight: 1 })[0]!.finalScore,
    ).toBe(4);
    expect(
      computeResults({ ...base, participants, evaluations, teamWeight: 0 })[0]!.finalScore,
    ).toBe(10);
  });

  it('no facet → no recommended rank', () => {
    const [a] = computeResults({
      ...base,
      facetKey: null,
      participants: [{ memberId: 'a', teamId: 'T1' }],
      evaluations: [{ teamId: 'T1', memberId: null, overallScore: 9.5 }],
    });
    expect(a!.outcome).toBe('distinction');
    expect(a!.recommendedRank).toBeNull();
  });
});
