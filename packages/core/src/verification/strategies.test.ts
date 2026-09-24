import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import {
  auditLogs,
  contributions,
  domainEvents,
  evidence,
  memberAchievements,
  memberCapabilities,
  rankHistory,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { UserActor } from '../permissions/actor';
import { ConflictError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { reviewEvidence, setVerifiedRank, submitEvidence } from '../identity/capabilities.service';
import { grantRoleUnchecked, revokeRoleUnchecked } from '../identity/roles.service';
import { resolveUserActor } from '../identity/users.service';
import {
  decideVerification,
  requestVerification,
  revokeVerification,
  type VerificationTarget,
} from './index';
import {
  addProjectMember,
  createContribution,
  createMemberAchievement,
  createProject,
  createTrialResult,
  KIT_SETUP_TIMEOUT_MS,
  KIT_TEST_OPTIONS,
  leaveProject,
} from './testing/fixtures';

describe('verification strategies', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  let ops: UserActor;
  let core: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
    core = await kit.member({ roles: ['core'] });
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  async function approve(actor: UserActor, subject: UserActor, target: VerificationTarget) {
    const requested = await requestVerification(kit.as(subject), { target });
    kit.clock.advance(1000);
    return decideVerification(kit.as(actor), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Evidence checks out.',
    });
  }

  async function revoke(actor: UserActor, verificationId: string) {
    kit.clock.advance(1000);
    return revokeVerification(kit.as(actor), {
      verificationId,
      reason: 'Evidence was fabricated.',
    });
  }

  async function rolesOf(member: UserActor) {
    return (await resolveUserActor(kit.system, member.userId)).roles;
  }

  describe('evidence', () => {
    it('revocation returns evidence the approval accepted to submitted; other reviews stand', async () => {
      const member = await kit.member({ roles: ['trial'] });
      const reviewedElsewhere = await submitEvidence(kit.as(member), { title: 'Old review' });
      await reviewEvidence(kit.as(core), {
        evidenceId: reviewedElsewhere.id,
        decision: 'accepted',
      });
      const requested = await requestVerification(kit.as(member), {
        target: { type: 'identity' },
        evidence: [{ title: 'Portfolio', url: 'https://example.com/portfolio' }],
        evidenceIds: [reviewedElsewhere.id],
      });
      kit.clock.advance(1000);
      await decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'Portfolio checks out.',
      });
      const statusOf = async (title: string) =>
        (
          await kit.db
            .select({ status: evidence.status })
            .from(evidence)
            .where(and(eq(evidence.memberId, member.memberId!), eq(evidence.title, title)))
        )[0]!.status;
      expect(await statusOf('Portfolio')).toBe('accepted');
      await revoke(ops, requested.id);
      expect(await statusOf('Portfolio')).toBe('submitted');
      expect(await statusOf('Old review')).toBe('accepted');
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'verification.revoked'));
      expect(audit!.context).toMatchObject({ evidenceRestored: 1 });
    });
  });

  describe('identity', () => {
    it('grants VERIFIED (retiring TRIAL) and revocation restores TRIAL', async () => {
      const member = await kit.member({ roles: ['trial'] });
      const approved = await approve(ops, member, { type: 'identity' });
      expect(approved.staff?.outcome).toEqual({
        kind: 'role',
        granted: true,
        previousRole: 'trial',
      });
      expect(await rolesOf(member)).toEqual(['verified']);

      const revoked = await revoke(ops, approved.id);
      expect(revoked).toMatchObject({
        status: 'revoked',
        revokeReason: 'Evidence was fabricated.',
      });
      expect(await rolesOf(member)).toEqual(['trial']);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'verification.revoked'));
      expect(audit!.context).toMatchObject({
        reverted: true,
        detail: 'verified_revoked_trial_restored',
      });
    });

    it('records granted=false when VERIFIED arrived in the meantime; revocation leaves it', async () => {
      const member = await kit.member();
      const requested = await requestVerification(kit.as(member), { target: { type: 'identity' } });
      await grantRoleUnchecked(kit.system, {
        memberId: member.memberId!,
        role: 'verified',
        reason: 'granted elsewhere',
      });
      const approved = await decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'Already verified; confirming.',
      });
      expect(approved.staff?.outcome).toEqual({ kind: 'role', granted: false, previousRole: null });
      await revoke(ops, approved.id);
      expect(await rolesOf(member)).toEqual(['verified']);
    });

    it('revocation leaves a VERIFIED grant it did not make, and never demotes staff to TRIAL', async () => {
      const regranted = await kit.member({ roles: ['trial'] });
      const first = await approve(ops, regranted, { type: 'identity' });
      await revokeRoleUnchecked(kit.system, {
        memberId: regranted.memberId!,
        role: 'verified',
        reason: 'manual',
      });
      await grantRoleUnchecked(kit.system, {
        memberId: regranted.memberId!,
        role: 'verified',
        reason: 'manual re-grant',
      });
      await revoke(ops, first.id);
      expect(await rolesOf(regranted)).toEqual(['verified']);

      const promoted = await kit.member({ roles: ['trial'] });
      const second = await approve(ops, promoted, { type: 'identity' });
      await grantRoleUnchecked(kit.system, {
        memberId: promoted.memberId!,
        role: 'moderator',
        reason: 'promotion',
      });
      await revoke(ops, second.id);
      expect(await rolesOf(promoted)).toEqual(['moderator']);
    });

    it('refuses staff (verified-equivalent), VERIFIED and ineligible subjects', async () => {
      const verified = await kit.member({ roles: ['verified'] });
      await expect(
        requestVerification(kit.as(verified), { target: { type: 'identity' } }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        requestVerification(kit.as(ops), { target: { type: 'identity' } }),
      ).rejects.toThrow(/verified-equivalent/);
      const outsider = await kit.member({ inGuild: false });
      await expect(
        requestVerification(kit.as(outsider), { target: { type: 'identity' } }),
      ).rejects.toThrow(/MEMBER, APPLICANT or TRIAL/);
    });
  });

  describe('skill', () => {
    it('restores the previous verified rank on revocation', async () => {
      const member = await kit.member({ roles: ['verified'] });
      await setVerifiedRank(kit.as(core), {
        memberId: member.memberId!,
        facetKey: 'mind.research',
        rank: 'C',
        reason: 'Baseline evaluation',
      });
      kit.clock.advance(1000);
      const approved = await approve(core, member, {
        type: 'skill',
        facetKey: 'mind.research',
        requestedRank: 'B',
      });
      expect(approved.staff?.outcome).toMatchObject({ previousRank: 'C', grantedRank: 'B' });
      await revoke(core, approved.id);
      const [capability] = await kit.db
        .select()
        .from(memberCapabilities)
        .where(eq(memberCapabilities.memberId, member.memberId!));
      expect(capability!.verifiedRank).toBe('C');
      const [latest] = await kit.db
        .select()
        .from(rankHistory)
        .where(eq(rankHistory.memberId, member.memberId!))
        .orderBy(desc(rankHistory.createdAt))
        .limit(1);
      expect(latest).toMatchObject({ fromRank: 'B', toRank: 'C', source: 'verification' });
    });

    it('does not undo a newer rank decision', async () => {
      const member = await kit.member({ roles: ['verified'] });
      const approved = await approve(core, member, {
        type: 'skill',
        facetKey: 'mind.knowledge',
        requestedRank: 'C',
      });
      kit.clock.advance(1000);
      const other = await kit.member({ roles: ['core'] });
      await setVerifiedRank(kit.as(other), {
        memberId: member.memberId!,
        facetKey: 'mind.knowledge',
        rank: 'A',
        reason: 'Later evaluation',
      });
      await revoke(core, approved.id);
      const [capability] = await kit.db
        .select()
        .from(memberCapabilities)
        .where(eq(memberCapabilities.memberId, member.memberId!));
      expect(capability!.verifiedRank).toBe('A');
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'verification.revoked'));
      expect(audit!.context).toMatchObject({
        reverted: false,
        detail: 'rank_changed_after_approval',
      });
    });

    it('refuses requests at or below the current verified rank, and stale approvals', async () => {
      const member = await kit.member({ roles: ['verified'] });
      await setVerifiedRank(kit.as(core), {
        memberId: member.memberId!,
        facetKey: 'body.physical',
        rank: 'B',
        reason: 'Evaluated',
      });
      await expect(
        requestVerification(kit.as(member), {
          target: { type: 'skill', facetKey: 'body.physical', requestedRank: 'B' },
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      const requested = await requestVerification(kit.as(member), {
        target: { type: 'skill', facetKey: 'body.physical', requestedRank: 'A' },
      });
      await expect(
        decideVerification(kit.as(core), {
          verificationId: requested.id,
          decision: 'approve',
          note: 'Downgrade attempt',
          grantedRank: 'C',
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        decideVerification(kit.as(core), {
          verificationId: requested.id,
          decision: 'approve',
          note: 'Unknown tier',
          grantedRank: 'SS',
        }),
      ).rejects.toThrow('Unknown rank.');
    });
  });

  describe('project', () => {
    it('records accepted project evidence; revocation withdraws it; one approval per member', async () => {
      const owner = await kit.member();
      const member = await kit.member();
      const { projectId } = await createProject(kit, owner.memberId!, { title: 'Atlas' });
      await addProjectMember(kit, projectId, member.memberId!, 'maintainer');
      const approved = await approve(ops, member, { type: 'project', projectId });
      expect(approved.claim).toBe('Active maintainer of Atlas.');
      const outcome = approved.staff?.outcome;
      expect(outcome?.kind).toBe('evidence');
      const recorded = approved.evidence.find((e) => e.kind === 'project')!;
      expect(recorded).toMatchObject({ status: 'accepted', title: 'Project member — Atlas' });

      await expect(
        requestVerification(kit.as(member), { target: { type: 'project', projectId } }),
      ).rejects.toThrow(/Already verified/);
      // The owner's membership is a separate target.
      await requestVerification(kit.as(owner), { target: { type: 'project', projectId } });

      await revoke(ops, approved.id);
      const [row] = await kit.db.select().from(evidence).where(eq(evidence.id, recorded.id));
      expect(row!.status).toBe('rejected');
    });

    it('requires an active membership at request and at decision time', async () => {
      const owner = await kit.member();
      const member = await kit.member();
      const { projectId } = await createProject(kit, owner.memberId!);
      await expect(
        requestVerification(kit.as(member), { target: { type: 'project', projectId } }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await addProjectMember(kit, projectId, member.memberId!);
      const requested = await requestVerification(kit.as(member), {
        target: { type: 'project', projectId },
      });
      await leaveProject(kit, projectId, member.memberId!);
      await expect(
        decideVerification(kit.as(ops), {
          verificationId: requested.id,
          decision: 'approve',
          note: 'Looks fine',
        }),
      ).rejects.toThrow(/no longer an active member/);
    });
  });

  describe('contribution', () => {
    it('marks the contribution verified, publishes contribution.verified, and reverts on revocation', async () => {
      const member = await kit.member();
      const { contributionId } = await createContribution(kit, member.memberId!, {
        title: 'Ingestion pipeline',
      });
      const approved = await approve(ops, member, { type: 'contribution', contributionId });
      const [row] = await kit.db
        .select()
        .from(contributions)
        .where(eq(contributions.id, contributionId));
      expect(row).toMatchObject({ status: 'verified', verifiedByUserId: ops.userId });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'contribution.verified'));
      expect(events[0]).toMatchObject({
        subjectMemberId: member.memberId,
        aggregateId: contributionId,
      });

      await revoke(ops, approved.id);
      const [after] = await kit.db
        .select()
        .from(contributions)
        .where(eq(contributions.id, contributionId));
      expect(after).toMatchObject({
        status: 'submitted',
        verifiedByUserId: null,
        verifiedAt: null,
      });
    });

    it('revocation does not undo a later, independent contribution verification', async () => {
      const member = await kit.member();
      const { contributionId } = await createContribution(kit, member.memberId!);
      const approved = await approve(ops, member, { type: 'contribution', contributionId });
      kit.clock.advance(1000);
      await kit.db
        .update(contributions)
        .set({ verifiedByUserId: core.userId, verifiedAt: kit.clock.now() })
        .where(eq(contributions.id, contributionId));
      await revoke(ops, approved.id);
      const [row] = await kit.db
        .select()
        .from(contributions)
        .where(eq(contributions.id, contributionId));
      expect(row).toMatchObject({ status: 'verified', verifiedByUserId: core.userId });
    });

    it('refuses already verified and rejected contributions', async () => {
      const member = await kit.member();
      const verified = await createContribution(kit, member.memberId!, { status: 'verified' });
      const rejected = await createContribution(kit, member.memberId!, { status: 'rejected' });
      await expect(
        requestVerification(kit.as(member), { target: { type: 'contribution', ...verified } }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        requestVerification(kit.as(member), { target: { type: 'contribution', ...rejected } }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe('achievement', () => {
    it('sets verification = verified and back to unverified on revocation', async () => {
      const member = await kit.member();
      const { memberAchievementId } = await createMemberAchievement(kit, member.memberId!);
      const approved = await approve(ops, member, { type: 'achievement', memberAchievementId });
      expect(approved.targetLabel).toBe('BUILDER');
      const [row] = await kit.db
        .select()
        .from(memberAchievements)
        .where(eq(memberAchievements.id, memberAchievementId));
      expect(row).toMatchObject({ verification: 'verified', verifiedByUserId: ops.userId });
      await revoke(ops, approved.id);
      const [after] = await kit.db
        .select()
        .from(memberAchievements)
        .where(eq(memberAchievements.id, memberAchievementId));
      expect(after).toMatchObject({ verification: 'unverified', verifiedByUserId: null });
    });

    it('refuses revoked achievements', async () => {
      const member = await kit.member();
      const revoked = await createMemberAchievement(kit, member.memberId!, { revoked: true });
      await expect(
        requestVerification(kit.as(member), { target: { type: 'achievement', ...revoked } }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('trial', () => {
    it('records accepted trial evidence tagged with the facet', async () => {
      const member = await kit.member({ roles: ['trial'] });
      const { trialResultId } = await createTrialResult(kit, member.memberId!);
      const approved = await approve(ops, member, { type: 'trial', trialResultId });
      expect(approved.targetLabel).toMatch(/— PASS$/);
      const [row] = await kit.db
        .select()
        .from(evidence)
        .where(and(eq(evidence.memberId, member.memberId!), eq(evidence.kind, 'trial')));
      expect(row).toMatchObject({
        status: 'accepted',
        facetKey: 'create.technical',
        sourceType: 'trial_result',
        sourceId: trialResultId,
      });
      await revoke(ops, approved.id);
      const [after] = await kit.db.select().from(evidence).where(eq(evidence.id, row!.id));
      expect(after!.status).toBe('rejected');
    });

    it('drops unknown facets and refuses unpublished results', async () => {
      const member = await kit.member({ roles: ['trial'] });
      const odd = await createTrialResult(kit, member.memberId!, { facetKey: 'mind.telepathy' });
      await approve(ops, member, { type: 'trial', ...odd });
      const [row] = await kit.db
        .select()
        .from(evidence)
        .where(and(eq(evidence.memberId, member.memberId!), eq(evidence.kind, 'trial')));
      expect(row!.facetKey).toBeNull();
      const hidden = await createTrialResult(kit, member.memberId!, { published: false });
      await expect(
        requestVerification(kit.as(member), { target: { type: 'trial', ...hidden } }),
      ).rejects.toThrow(/not published/);
    });
  });
});
