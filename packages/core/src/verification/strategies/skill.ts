import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { memberCapabilities, rankHistory } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../../kernel/errors';
import { setVerifiedRank } from '../../identity/capabilities.service';
import { isValidRank, loadCatalog, rankOrdinal } from '../../identity/ranks';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { LoadedVerification, VerificationStrategy } from '../types';
import { expectTarget } from './shared';

/** setVerifiedRank caps reasons at this length. */
const MAX_RANK_REASON = 2000;

async function currentVerifiedRank(
  ctx: ServiceContext,
  memberId: string,
  facetKey: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ verifiedRank: memberCapabilities.verifiedRank })
    .from(memberCapabilities)
    .where(
      and(eq(memberCapabilities.memberId, memberId), eq(memberCapabilities.facetKey, facetKey)),
    );
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
 * True when a verified-track rank change other than `approvalHistoryId`
 * happened at or after the approval (another evaluator moved the rank since).
 */
async function rankChangedSince(
  tx: ServiceContext,
  memberId: string,
  facetKey: string,
  approvalHistoryId: string,
): Promise<boolean> {
  const [approval] = await tx.db
    .select({ createdAt: rankHistory.createdAt })
    .from(rankHistory)
    .where(eq(rankHistory.id, approvalHistoryId));
  if (!approval) return true;
  const [later] = await tx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(rankHistory)
    .where(
      and(
        eq(rankHistory.memberId, memberId),
        eq(rankHistory.facetKey, facetKey),
        eq(rankHistory.track, 'verified'),
        gte(rankHistory.createdAt, approval.createdAt),
        ne(rankHistory.id, approvalHistoryId),
      ),
    );
  return (later?.count ?? 0) > 0;
}

/**
 * Skill verification: a facet and a requested rank. Approval sets the VERIFIED
 * rank through the identity module (source 'verification', sourceRef = the
 * verification id); the verifier may grant a different rank than requested,
 * but only one above the current verified rank. Deciding requires
 * canModifyRanks in addition to canVerifyMembers.
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
    const previousRank = await currentVerifiedRank(tx, verification.subjectMemberId, facetKey);
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
    const current = await currentVerifiedRank(tx, verification.subjectMemberId, outcome.facetKey);
    const changed =
      current !== outcome.grantedRank ||
      (await rankChangedSince(
        tx,
        verification.subjectMemberId,
        outcome.facetKey,
        outcome.rankHistoryId,
      ));
    if (changed)
      return { reverted: false, detail: 'rank_changed_after_approval', subjectNotified: false };
    await setVerifiedRank(tx, {
      memberId: verification.subjectMemberId,
      facetKey: outcome.facetKey,
      rank: outcome.previousRank,
      reason: `${input.reference} revoked: ${input.reason}`.slice(0, MAX_RANK_REASON),
      source: 'verification',
      sourceRef: verification.id,
    });
    return { reverted: true, detail: 'rank_restored', subjectNotified: true };
  },
};
