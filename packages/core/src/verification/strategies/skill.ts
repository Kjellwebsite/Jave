import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or } from 'drizzle-orm';
import { memberCapabilities, rankHistory, verifications } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../../kernel/errors';
import { setVerifiedRank } from '../../identity/capabilities.service';
import { isValidRank, loadCatalog, rankOrdinal } from '../../identity/ranks';
import { expectOutcome, safeParseOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { LoadedVerification, VerificationStrategy } from '../types';
import { planRankRevert, type RankBarrier, type RankLayer } from './rank-layers';
import { expectTarget } from './shared';

/** setVerifiedRank caps reasons at this length. */
const MAX_RANK_REASON = 2000;

/**
 * The member's verified rank for a facet. With `lock`, the capability row is
 * locked so approvals and revocations on one facet run one at a time
 * (setVerifiedRank takes the same lock).
 */
async function currentVerifiedRank(
  ctx: ServiceContext,
  memberId: string,
  facetKey: string,
  options: { lock?: boolean } = {},
): Promise<string | null> {
  const query = ctx.db
    .select({ verifiedRank: memberCapabilities.verifiedRank })
    .from(memberCapabilities)
    .where(
      and(eq(memberCapabilities.memberId, memberId), eq(memberCapabilities.facetKey, facetKey)),
    );
  const [row] = options.lock ? await query.for('update') : await query;
  return row?.verifiedRank ?? null;
}

function requireSkillFields(verification: LoadedVerification): {
  facetKey: string;
  requestedRank: string;
} {
  if (!verification.facetKey || !verification.requestedRank)
    throw new InvalidStateError('This verification has no capability or rank on record.');
  return { facetKey: verification.facetKey, requestedRank: verification.requestedRank };
}

/**
 * Every skill approval that changed this member's verified rank for the facet
 * (still approved or since revoked), and the latest verified-rank change that
 * none of them made. See rank-layers.ts.
 */
async function loadRankLayers(
  tx: ServiceContext,
  memberId: string,
  facetKey: string,
): Promise<{ layers: RankLayer[]; barrier: RankBarrier | null }> {
  const rows = await tx.db
    .select({ id: verifications.id, status: verifications.status, outcome: verifications.outcome })
    .from(verifications)
    .where(
      and(
        eq(verifications.type, 'skill'),
        eq(verifications.subjectMemberId, memberId),
        eq(verifications.facetKey, facetKey),
        isNotNull(verifications.outcome),
      ),
    );
  const approvals = rows.flatMap((row) => {
    const outcome = safeParseOutcome(row.outcome);
    return outcome?.kind === 'rank' && outcome.facetKey === facetKey
      ? [{ id: row.id, status: row.status, outcome }]
      : [];
  });
  const facetHistory = and(
    eq(rankHistory.memberId, memberId),
    eq(rankHistory.facetKey, facetKey),
    eq(rankHistory.track, 'verified'),
  );
  const historyIds = approvals.flatMap((a) =>
    a.outcome.rankHistoryId ? [a.outcome.rankHistoryId] : [],
  );
  const approvalRows =
    historyIds.length === 0
      ? []
      : await tx.db
          .select({ id: rankHistory.id, createdAt: rankHistory.createdAt })
          .from(rankHistory)
          .where(and(facetHistory, inArray(rankHistory.id, historyIds)));
  const approvedAt = new Map(approvalRows.map((row) => [row.id, row.createdAt]));
  const layers = approvals.flatMap((a): RankLayer[] => {
    const at = a.outcome.rankHistoryId ? approvedAt.get(a.outcome.rankHistoryId) : undefined;
    if (!at) return [];
    return [
      {
        verificationId: a.id,
        status: a.status,
        grantedRank: a.outcome.grantedRank,
        approvedAt: at,
      },
    ];
  });
  const ownIds = approvals.map((a) => a.id);
  const notOwn =
    ownIds.length === 0
      ? undefined
      : or(
          ne(rankHistory.source, 'verification'),
          isNull(rankHistory.sourceRef),
          notInArray(rankHistory.sourceRef, ownIds),
        );
  const [barrier] = await tx.db
    .select({ at: rankHistory.createdAt, rank: rankHistory.toRank })
    .from(rankHistory)
    .where(and(facetHistory, notOwn))
    .orderBy(desc(rankHistory.createdAt))
    .limit(1);
  return { layers, barrier: barrier ?? null };
}

/**
 * Skill verification: a facet and a requested rank. Approval sets the VERIFIED
 * rank through the identity module (source 'verification', sourceRef = the
 * verification id); the verifier may grant a different rank than requested,
 * but only one above the current verified rank. Deciding requires
 * canModifyRanks in addition to canVerifyMembers.
 *
 * Revocation reverts the rank only while this approval holds it, and restores
 * the next approval below that still stands (skipping revoked ones), or the
 * rank the last other change set. See rank-layers.ts.
 */
export const skillStrategy: VerificationStrategy = {
  type: 'skill',
  deciderCapabilities: ['canModifyRanks'],
  singleApproval: false,

  async resolveTarget(ctx, subject, target) {
    const skill = expectTarget(target, 'skill');
    const catalog = await loadCatalog(ctx);
    const facet = catalog.facets.find((f) => f.key === skill.facetKey);
    if (!facet) throw new ValidationError('Unknown capability.');
    if (!isValidRank(catalog, skill.requestedRank)) throw new ValidationError('Unknown rank.');
    const current = await currentVerifiedRank(ctx, subject.id, facet.key);
    if (
      current &&
      rankOrdinal(catalog.tiers, skill.requestedRank) <= rankOrdinal(catalog.tiers, current)
    )
      throw new ConflictError(`${facet.label} is already verified at ${current}.`);
    return {
      targetType: 'facet',
      targetId: null,
      targetKey: targetKeys.skill(subject.id, facet.key),
      targetLabel: facet.label,
      facetKey: facet.key,
      requestedRank: skill.requestedRank,
      defaultClaim: `${facet.label} at ${skill.requestedRank}.`,
    };
  },

  async approve(tx, verification, input) {
    const { facetKey, requestedRank } = requireSkillFields(verification);
    const grantedRank = input.grantedRank ?? requestedRank;
    const catalog = await loadCatalog(tx);
    if (!isValidRank(catalog, grantedRank)) throw new ValidationError('Unknown rank.');
    const previousRank = await currentVerifiedRank(tx, verification.subjectMemberId, facetKey, {
      lock: true,
    });
    if (
      previousRank &&
      rankOrdinal(catalog.tiers, grantedRank) <= rankOrdinal(catalog.tiers, previousRank)
    )
      throw new InvalidStateError(
        `The verified rank is already ${previousRank}. Grant a higher rank or reject.`,
      );
    const result = await setVerifiedRank(tx, {
      memberId: verification.subjectMemberId,
      facetKey,
      rank: grantedRank,
      reason: `${input.reference} approved: ${input.note}`.slice(0, MAX_RANK_REASON),
      source: 'verification',
      sourceRef: verification.id,
    });
    const rankHistoryId = ('historyId' in result ? result.historyId : null) ?? null;
    return {
      outcome: { kind: 'rank', facetKey, previousRank, grantedRank, rankHistoryId },
      grantedRank,
      subjectNotified: result.changed,
    };
  },

  async revoke(tx, verification, stored, input) {
    const outcome = expectOutcome(stored, 'rank');
    if (!outcome.rankHistoryId)
      return {
        reverted: false,
        detail: 'rank_not_changed_by_verification',
        subjectNotified: false,
      };
    const memberId = verification.subjectMemberId;
    const currentRank = await currentVerifiedRank(tx, memberId, outcome.facetKey, { lock: true });
    const catalog = await loadCatalog(tx);
    const { layers, barrier } = await loadRankLayers(tx, memberId, outcome.facetKey);
    const plan = planRankRevert({
      verificationId: verification.id,
      currentRank,
      layers,
      barrier,
      ordinal: (rank) => rankOrdinal(catalog.tiers, rank),
    });
    if (!plan.revert) return { reverted: false, detail: plan.detail, subjectNotified: false };
    const result = await setVerifiedRank(tx, {
      memberId,
      facetKey: outcome.facetKey,
      rank: plan.restoreTo,
      reason: `${input.reference} revoked: ${input.reason}`.slice(0, MAX_RANK_REASON),
      source: 'verification',
      sourceRef: verification.id,
    });
    return {
      reverted: result.changed,
      detail: result.changed ? 'rank_restored' : 'rank_unchanged',
      subjectNotified: result.changed,
    };
  },
};
