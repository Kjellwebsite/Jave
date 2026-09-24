import { and, eq, isNull } from 'drizzle-orm';
import { projectMembers, projects } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { InvalidStateError, NotFoundError } from '../../kernel/errors';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { VerificationStrategy } from '../types';
import {
  expectTarget,
  recordOutcomeEvidence,
  requireTargetId,
  withdrawOutcomeEvidence,
} from './shared';

async function activeMembership(ctx: ServiceContext, projectId: string, memberId: string) {
  const [row] = await ctx.db
    .select({ title: projects.title, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.leftAt),
        isNull(projects.deletedAt),
      ),
    );
  return row ?? null;
}

/**
 * Project verification: the subject's active membership (and role) in a
 * project. Approval records accepted evidence of kind 'project'; revocation
 * withdraws it.
 */
export const projectStrategy: VerificationStrategy = {
  type: 'project',
  deciderCapabilities: [],
  singleApproval: true,

  async resolveTarget(ctx, subject, target) {
    const { projectId } = expectTarget(target, 'project');
    const membership = await activeMembership(ctx, projectId, subject.id);
    // Missing project and non-membership look the same: no existence oracle.
    if (!membership) throw new NotFoundError('Active project membership');
    return {
      targetType: 'project',
      targetId: projectId,
      targetKey: targetKeys.project(projectId, subject.id),
      targetLabel: membership.title,
      facetKey: null,
      requestedRank: null,
      defaultClaim: `Active ${membership.role} of ${membership.title}.`,
    };
  },

  async approve(tx, verification, input) {
    const projectId = requireTargetId(verification);
    const membership = await activeMembership(tx, projectId, verification.subjectMemberId);
    if (!membership)
      throw new InvalidStateError('The member is no longer an active member of this project.');
    const evidenceId = await recordOutcomeEvidence(tx, verification, {
      kind: 'project',
      title: `Project member — ${membership.title}`,
      description: `Verified ${membership.role} of ${membership.title} (${input.reference}).`,
      sourceType: 'project',
      sourceId: projectId,
      facetKey: null,
      decidedAt: input.decidedAt,
    });
    return {
      outcome: { kind: 'evidence', evidenceId },
      grantedRank: null,
      subjectNotified: false,
    };
  },

  async revoke(tx, _verification, stored) {
    const outcome = expectOutcome(stored, 'evidence');
    const withdrawn = await withdrawOutcomeEvidence(tx, outcome.evidenceId);
    return {
      reverted: withdrawn,
      detail: withdrawn ? 'evidence_withdrawn' : 'evidence_already_withdrawn',
      subjectNotified: false,
    };
  },
};
