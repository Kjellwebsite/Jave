import { and, eq, isNull, sql } from 'drizzle-orm';
import { achievementDefinitions, memberAchievements } from '@jave/database';
import { ConflictError, InvalidStateError, NotFoundError } from '../../kernel/errors';
import { actorUserId } from '../../permissions/actor';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { VerificationStrategy } from '../types';
import { expectTarget, requireDecidedAt, requireTargetId } from './shared';

/**
 * Achievement verification: an active (non-revoked) member_achievements row
 * of the subject. Approval sets verification = verified (+ verifiedBy/At);
 * revocation returns it to unverified.
 */
export const achievementStrategy: VerificationStrategy = {
  type: 'achievement',
  deciderCapabilities: [],
  singleApproval: false,

  async resolveTarget(ctx, subject, target) {
    const { memberAchievementId } = expectTarget(target, 'achievement');
    const [row] = await ctx.db
      .select({
        memberId: memberAchievements.memberId,
        revokedAt: memberAchievements.revokedAt,
        verification: memberAchievements.verification,
        title: achievementDefinitions.title,
      })
      .from(memberAchievements)
      .innerJoin(
        achievementDefinitions,
        eq(achievementDefinitions.key, memberAchievements.achievementKey),
      )
      .where(eq(memberAchievements.id, memberAchievementId));
    if (!row || row.memberId !== subject.id || row.revokedAt)
      throw new NotFoundError('Achievement');
    if (row.verification === 'verified')
      throw new ConflictError('This achievement is already verified.');
    return {
      targetType: 'member_achievement',
      targetId: memberAchievementId,
      targetKey: targetKeys.achievement(memberAchievementId),
      targetLabel: row.title,
      facetKey: null,
      requestedRank: null,
      defaultClaim: `Achievement: ${row.title}.`,
    };
  },

  async approve(tx, verification, input) {
    const memberAchievementId = requireTargetId(verification);
    const rows = await tx.db
      .update(memberAchievements)
      .set({
        verification: 'verified',
        verifiedByUserId: actorUserId(tx.actor),
        verifiedAt: input.decidedAt,
      })
      .where(
        and(
          eq(memberAchievements.id, memberAchievementId),
          eq(memberAchievements.memberId, verification.subjectMemberId),
          eq(memberAchievements.verification, 'unverified'),
          isNull(memberAchievements.revokedAt),
        ),
      )
      .returning({ id: memberAchievements.id });
    if (rows.length === 0)
      throw new InvalidStateError('This achievement is no longer awaiting verification.');
    return {
      outcome: { kind: 'achievement', memberAchievementId },
      grantedRank: null,
      subjectNotified: false,
    };
  },

  async revoke(tx, verification, stored) {
    const outcome = expectOutcome(stored, 'achievement');
    const rows = await tx.db
      .update(memberAchievements)
      .set({ verification: 'unverified', verifiedByUserId: null, verifiedAt: null })
      .where(
        and(
          eq(memberAchievements.id, outcome.memberAchievementId),
          eq(memberAchievements.memberId, verification.subjectMemberId),
          eq(memberAchievements.verification, 'verified'),
          // Only undo our own verification, not one made independently since.
          sql`${memberAchievements.verifiedByUserId} is not distinct from ${verification.verifierUserId}`,
          eq(memberAchievements.verifiedAt, requireDecidedAt(verification)),
        ),
      )
      .returning({ id: memberAchievements.id });
    return {
      reverted: rows.length > 0,
      detail: rows.length > 0 ? 'achievement_unverified' : 'achievement_not_verified',
      subjectNotified: false,
    };
  },
};
