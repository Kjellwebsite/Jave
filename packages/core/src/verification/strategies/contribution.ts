import { and, eq, sql } from 'drizzle-orm';
import { contributions } from '@jave/database';
import { ConflictError, InvalidStateError, NotFoundError } from '../../kernel/errors';
import { publishEvent } from '../../events/bus';
import { actorUserId } from '../../permissions/actor';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { VerificationStrategy } from '../types';
import { expectTarget, requireDecidedAt, requireTargetId } from './shared';

/**
 * Contribution verification: a contribution the subject recorded. Approval
 * sets contributions.status = verified (+ verifiedBy/At) and publishes
 * contribution.verified. Rejection leaves the contribution untouched (a
 * rejected verification means "not proven", not "false"). Revocation returns
 * it to submitted. Deciding also requires canVerifyContributions.
 */
export const contributionStrategy: VerificationStrategy = {
  type: 'contribution',
  deciderCapabilities: ['canVerifyContributions'],
  singleApproval: false,

  async resolveTarget(ctx, subject, target) {
    const { contributionId } = expectTarget(target, 'contribution');
    const [row] = await ctx.db
      .select({
        memberId: contributions.memberId,
        title: contributions.title,
        status: contributions.status,
      })
      .from(contributions)
      .where(eq(contributions.id, contributionId));
    if (!row || row.memberId !== subject.id) throw new NotFoundError('Contribution');
    if (row.status === 'verified')
      throw new ConflictError('This contribution is already verified.');
    if (row.status === 'rejected')
      throw new InvalidStateError('Rejected contributions cannot be verified.');
    return {
      targetType: 'contribution',
      targetId: contributionId,
      targetKey: targetKeys.contribution(contributionId),
      targetLabel: row.title,
      facetKey: null,
      requestedRank: null,
      defaultClaim: `Contribution: ${row.title}.`,
    };
  },

  async approve(tx, verification, input) {
    const contributionId = requireTargetId(verification);
    const [row] = await tx.db
      .update(contributions)
      .set({
        status: 'verified',
        verifiedByUserId: actorUserId(tx.actor),
        verifiedAt: input.decidedAt,
      })
      .where(
        and(
          eq(contributions.id, contributionId),
          eq(contributions.memberId, verification.subjectMemberId),
          eq(contributions.status, 'submitted'),
        ),
      )
      .returning({
        id: contributions.id,
        projectId: contributions.projectId,
        kind: contributions.kind,
      });
    if (!row) throw new InvalidStateError('This contribution is no longer awaiting verification.');
    await publishEvent(tx, {
      type: 'contribution.verified',
      aggregateType: 'contribution',
      aggregateId: row.id,
      subjectMemberId: verification.subjectMemberId,
      payload: {
        contributionId: row.id,
        projectId: row.projectId,
        kind: row.kind,
        verificationId: verification.id,
      },
    });
    return {
      outcome: { kind: 'contribution', contributionId: row.id },
      grantedRank: null,
      subjectNotified: false,
    };
  },

  async revoke(tx, verification, stored) {
    const outcome = expectOutcome(stored, 'contribution');
    const rows = await tx.db
      .update(contributions)
      .set({ status: 'submitted', verifiedByUserId: null, verifiedAt: null })
      .where(
        and(
          eq(contributions.id, outcome.contributionId),
          eq(contributions.memberId, verification.subjectMemberId),
          eq(contributions.status, 'verified'),
          // Only undo our own verification, not one made independently since.
          sql`${contributions.verifiedByUserId} is not distinct from ${verification.verifierUserId}`,
          eq(contributions.verifiedAt, requireDecidedAt(verification)),
        ),
      )
      .returning({ id: contributions.id });
    return {
      reverted: rows.length > 0,
      detail: rows.length > 0 ? 'contribution_unverified' : 'contribution_not_verified',
      subjectNotified: false,
    };
  },
};
