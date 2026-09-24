import { describe, expect, it } from 'vitest';
import { planRankRevert, type RankLayer } from './strategies/rank-layers';
import type { VerificationStatus } from './types';

const ORDINALS: Readonly<Record<string, number>> = { D: 30, C: 40, B: 50, A: 60 };
const ordinal = (rank: string) => ORDINALS[rank] ?? -1;
const at = (second: number) => new Date(Date.UTC(2026, 2, 1, 12, 0, second));

function layer(
  verificationId: string,
  grantedRank: string,
  second: number,
  status: VerificationStatus = 'approved',
): RankLayer {
  return { verificationId, status, grantedRank, approvedAt: at(second) };
}

describe('planRankRevert', () => {
  it('reverts a lone approval to the unset rank', () => {
    expect(
      planRankRevert({
        verificationId: 'v1',
        currentRank: 'C',
        layers: [layer('v1', 'C', 1)],
        barrier: null,
        ordinal,
      }),
    ).toEqual({ revert: true, restoreTo: null });
  });

  it('newest first: each revocation restores the approval below it', () => {
    const layers = [layer('v1', 'C', 1), layer('v2', 'B', 2)];
    expect(
      planRankRevert({ verificationId: 'v2', currentRank: 'B', layers, barrier: null, ordinal }),
    ).toEqual({ revert: true, restoreTo: 'C' });
    const afterFirst = [layer('v1', 'C', 1), layer('v2', 'B', 2, 'revoked')];
    expect(
      planRankRevert({
        verificationId: 'v1',
        currentRank: 'C',
        layers: afterFirst,
        barrier: null,
        ordinal,
      }),
    ).toEqual({ revert: true, restoreTo: null });
  });

  it('oldest first: the lower approval stays put, the top one then skips it', () => {
    const layers = [layer('v1', 'C', 1), layer('v2', 'B', 2)];
    expect(
      planRankRevert({ verificationId: 'v1', currentRank: 'B', layers, barrier: null, ordinal }),
    ).toEqual({ revert: false, detail: 'rank_held_by_other_verification' });
    const afterFirst = [layer('v1', 'C', 1, 'revoked'), layer('v2', 'B', 2)];
    expect(
      planRankRevert({
        verificationId: 'v2',
        currentRank: 'B',
        layers: afterFirst,
        barrier: null,
        ordinal,
      }),
    ).toEqual({ revert: true, restoreTo: null });
  });

  it('a revoked middle layer is skipped when the top one is revoked', () => {
    const layers = [layer('v1', 'D', 1), layer('v2', 'C', 2, 'revoked'), layer('v3', 'B', 3)];
    expect(
      planRankRevert({ verificationId: 'v3', currentRank: 'B', layers, barrier: null, ordinal }),
    ).toEqual({ revert: true, restoreTo: 'D' });
  });

  it('a later change from another source replaces earlier approvals', () => {
    const layers = [layer('v1', 'C', 1), layer('v2', 'B', 3)];
    const barrier = { at: at(2), rank: 'D' };
    expect(
      planRankRevert({ verificationId: 'v1', currentRank: 'B', layers, barrier, ordinal }),
    ).toEqual({ revert: false, detail: 'rank_changed_after_approval' });
    expect(
      planRankRevert({ verificationId: 'v2', currentRank: 'B', layers, barrier, ordinal }),
    ).toEqual({ revert: true, restoreTo: 'D' });
  });

  it('BREAK: a change in the same millisecond as the approval counts as later', () => {
    expect(
      planRankRevert({
        verificationId: 'v1',
        currentRank: 'C',
        layers: [layer('v1', 'C', 1)],
        barrier: { at: at(1), rank: 'C' },
        ordinal,
      }),
    ).toEqual({ revert: false, detail: 'rank_changed_after_approval' });
  });

  it('BREAK: never reverts when the current rank is not the one this approval granted', () => {
    expect(
      planRankRevert({
        verificationId: 'v1',
        currentRank: 'A',
        layers: [layer('v1', 'C', 1)],
        barrier: null,
        ordinal,
      }),
    ).toEqual({ revert: false, detail: 'rank_changed_after_approval' });
    expect(
      planRankRevert({
        verificationId: 'v2',
        currentRank: 'A',
        layers: [layer('v1', 'C', 1), layer('v2', 'B', 2)],
        barrier: null,
        ordinal,
      }),
    ).toEqual({ revert: false, detail: 'rank_changed_after_approval' });
  });

  it('BREAK: unknown, already revoked or foreign verifications never revert', () => {
    const layers = [layer('v1', 'C', 1, 'revoked'), layer('v2', 'B', 2)];
    for (const verificationId of ['v1', 'missing']) {
      expect(
        planRankRevert({ verificationId, currentRank: 'B', layers, barrier: null, ordinal }),
      ).toEqual({ revert: false, detail: 'rank_changed_after_approval' });
    }
  });

  it('BREAK: an equal-rank layer that still stands keeps the rank', () => {
    const layers = [layer('v1', 'C', 1), layer('v2', 'C', 2)];
    expect(
      planRankRevert({ verificationId: 'v2', currentRank: 'C', layers, barrier: null, ordinal }),
    ).toEqual({ revert: false, detail: 'rank_held_by_other_verification' });
  });
});
