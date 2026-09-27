import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../testing';
import { setVerifiedRank } from '../identity/capabilities.service';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../kernel/errors';
import {
  decideVerification,
  listGrantableRanks,
  listTargetCandidates,
  requestVerification,
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

describe('verification target candidates', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('lists only the member’s own requestable targets per type', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const other = await kit.member({ roles: ['trial'] });
    const ctx = kit.as(member);

    const { projectId } = await createProject(kit, member.memberId!, { title: 'Orbit tracker' });
    const { projectId: foreignProject } = await createProject(kit, other.memberId!);
    const { projectId: leftProject } = await createProject(kit, other.memberId!);
    await addProjectMember(kit, leftProject, member.memberId!);
    await leaveProject(kit, leftProject, member.memberId!);
    const projects = await listTargetCandidates(ctx, { type: 'project' });
    expect(projects.map((c) => c.targetId)).toEqual([projectId]);
    expect(projects[0]).toMatchObject({ label: 'Orbit tracker', detail: 'OWNER', ranks: [] });
    expect(projects.map((c) => c.targetId)).not.toContain(foreignProject);

    const { contributionId } = await createContribution(kit, member.memberId!, {
      title: 'Parser rewrite',
    });
    await createContribution(kit, member.memberId!, { status: 'verified' });
    await createContribution(kit, other.memberId!);
    const contributions = await listTargetCandidates(ctx, { type: 'contribution' });
    expect(contributions.map((c) => c.targetId)).toEqual([contributionId]);

    const { memberAchievementId } = await createMemberAchievement(kit, member.memberId!);
    await createMemberAchievement(kit, member.memberId!, { revoked: true });
    const achievements = await listTargetCandidates(ctx, { type: 'achievement' });
    expect(achievements.map((c) => c.targetId)).toEqual([memberAchievementId]);

    const { trialResultId } = await createTrialResult(kit, member.memberId!);
    await createTrialResult(kit, member.memberId!, { published: false });
    const trials = await listTargetCandidates(ctx, { type: 'trial' });
    expect(trials.map((c) => c.targetId)).toEqual([trialResultId]);
  });

  it('skill candidates offer only ranks above the verified rank', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const evaluator = await kit.member({ roles: ['core'] });
    await setVerifiedRank(kit.as(evaluator), {
      memberId: member.memberId!,
      facetKey: 'mind.research',
      rank: 'B',
      reason: 'Reviewed replication study.',
    });
    await setVerifiedRank(kit.as(evaluator), {
      memberId: member.memberId!,
      facetKey: 'create.technical',
      rank: 'S',
      reason: 'Shipped a compiler.',
    });
    const skills = await listTargetCandidates(kit.as(member), { type: 'skill' });
    const research = skills.find((c) => c.targetId === 'mind.research');
    expect(research).toMatchObject({ detail: 'VERIFIED B', ranks: ['S', 'A'] });
    expect(skills.find((c) => c.targetId === 'create.technical')).toBeUndefined();
    const reasoning = skills.find((c) => c.targetId === 'mind.reasoning');
    expect(reasoning?.ranks[0]).toBe('S');
    expect(reasoning?.detail).toBe('NOT VERIFIED');

    const filtered = await listTargetCandidates(kit.as(member), { type: 'skill', search: 'RESE' });
    expect(filtered.map((c) => c.targetId)).toEqual(['mind.research']);
  });

  it('offers verifiers only the ranks an approval can grant', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const evaluator = await kit.member({ roles: ['core'] });
    const verifier = await kit.member({ roles: ['core'] });
    const request = await requestVerification(kit.as(member), {
      target: { type: 'skill', facetKey: 'create.technical', requestedRank: 'A' },
    });
    expect(await listGrantableRanks(kit.as(verifier), { verificationId: request.id })).toEqual({
      currentVerifiedRank: null,
      ranks: ['S', 'A', 'B', 'C', 'D', 'E', 'F'],
    });
    // Verified at B by another route while the request is open.
    await setVerifiedRank(kit.as(evaluator), {
      memberId: member.memberId!,
      facetKey: 'create.technical',
      rank: 'B',
      reason: 'Evaluated in a trial.',
    });
    const grantable = await listGrantableRanks(kit.as(verifier), { verificationId: request.id });
    expect(grantable).toEqual({ currentVerifiedRank: 'B', ranks: ['S', 'A'] });
    // Every offered rank is one decideVerification accepts.
    const decided = await decideVerification(kit.as(verifier), {
      verificationId: request.id,
      decision: 'approve',
      grantedRank: grantable.ranks.at(-1),
      note: 'The compiler passes the conformance suite.',
    });
    expect(decided.grantedRank).toBe('A');
  });

  it('BREAK: grantable ranks are for verifiers, and for skill verifications only', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const ops = await kit.member({ roles: ['operations'] });
    const skill = await requestVerification(kit.as(member), {
      target: { type: 'skill', facetKey: 'mind.research', requestedRank: 'A' },
    });
    const identity = await requestVerification(kit.as(member), { target: { type: 'identity' } });
    await expect(
      listGrantableRanks(kit.as(member), { verificationId: skill.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listGrantableRanks(kit.as(ops), { verificationId: identity.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listGrantableRanks(kit.as(ops), { verificationId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('hides targets with an open request, and approved single-approval targets', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const verifier = await kit.member({ roles: ['operations'] });
    const ctx = kit.as(member);
    const { projectId } = await createProject(kit, member.memberId!);
    const request = await requestVerification(ctx, { target: { type: 'project', projectId } });
    expect(await listTargetCandidates(ctx, { type: 'project' })).toEqual([]);
    await decideVerification(kit.as(verifier), {
      verificationId: request.id,
      decision: 'approve',
      note: 'Confirmed on the repository.',
    });
    expect(await listTargetCandidates(ctx, { type: 'project' })).toEqual([]);

    await requestVerification(ctx, {
      target: { type: 'skill', facetKey: 'mind.research', requestedRank: 'A' },
    });
    const skills = await listTargetCandidates(ctx, { type: 'skill' });
    expect(skills.map((c) => c.targetId)).not.toContain('mind.research');
  });

  it('BREAK: refuses anonymous and profile-less callers, identity and oversized input', async () => {
    const member = await kit.member();
    await expect(
      listTargetCandidates(kit.as({ kind: 'anonymous' }), { type: 'project' }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      listTargetCandidates(kit.as({ ...member, memberId: null }), { type: 'project' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      listTargetCandidates(kit.as(member), { type: 'identity' as 'project' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      listTargetCandidates(kit.as(member), { type: 'project', search: 'x'.repeat(65) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
