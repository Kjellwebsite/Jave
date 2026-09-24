import type { VerificationStatus } from '../types';

/**
 * Skill approvals stack as layers on one member's verified rank for one
 * facet. An approval must grant a rank above the current one, and a
 * revocation that reverts restores the next live layer below. So, while
 * nothing else touches the rank, the live (approved) layers have strictly
 * increasing ranks and the verified rank is the highest of them.
 *
 * Any other verified-rank change (evaluator, trial, import, …) is a barrier:
 * it replaces every layer approved before it, and revoking those
 * verifications leaves the rank alone.
 */

/** A skill verification of this member and facet whose approval changed the verified rank. */
export interface RankLayer {
  verificationId: string;
  status: VerificationStatus;
  grantedRank: string;
  /** created_at of the approval's rank_history row. */
  approvedAt: Date;
}

/** The latest verified-rank change that no skill verification of this facet made. */
export interface RankBarrier {
  at: Date;
  rank: string | null;
}

export type RankRevertPlan =
  | { revert: true; restoreTo: string | null }
  | {
      revert: false;
      /**
       * rank_changed_after_approval: another source set the rank since, or the
       * rank no longer matches this approval.
       * rank_held_by_other_verification: another approval that still stands
       * (normally a later, higher one) holds the rank; revoking that one will
       * skip this layer.
       */
      detail: 'rank_changed_after_approval' | 'rank_held_by_other_verification';
    };

export interface RankRevertInput {
  verificationId: string;
  currentRank: string | null;
  layers: readonly RankLayer[];
  barrier: RankBarrier | null;
  ordinal: (rank: string) => number;
}

/**
 * Decide whether revoking `verificationId` reverts the verified rank, and to
 * what. A change in the same millisecond as an approval counts as later than
 * it (the layer is treated as replaced), which never writes a rank nobody
 * decided.
 */
export function planRankRevert(input: RankRevertInput): RankRevertPlan {
  const live = input.layers.filter(
    (layer) =>
      layer.status === 'approved' &&
      (input.barrier === null || layer.approvedAt.getTime() > input.barrier.at.getTime()),
  );
  const self = live.find((layer) => layer.verificationId === input.verificationId);
  if (!self) return { revert: false, detail: 'rank_changed_after_approval' };
  const selfOrdinal = input.ordinal(self.grantedRank);
  const others = live.filter((layer) => layer !== self);
  if (others.some((layer) => input.ordinal(layer.grantedRank) >= selfOrdinal))
    return { revert: false, detail: 'rank_held_by_other_verification' };
  if (input.currentRank !== self.grantedRank)
    return { revert: false, detail: 'rank_changed_after_approval' };
  const next = others.reduce<RankLayer | null>(
    (best, layer) =>
      best === null || input.ordinal(layer.grantedRank) > input.ordinal(best.grantedRank)
        ? layer
        : best,
    null,
  );
  if (next) return { revert: true, restoreTo: next.grantedRank };
  // setVerifiedRank is the only writer of verified ranks and always records
  // history, so with no other change on record the rank started unset.
  return { revert: true, restoreTo: input.barrier?.rank ?? null };
}
