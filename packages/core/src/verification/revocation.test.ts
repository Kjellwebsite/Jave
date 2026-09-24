import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, evidence, memberCapabilities } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { UserActor } from '../permissions/actor';
import { setVerifiedRank, submitEvidence } from '../identity/capabilities.service';
import {
  decideVerification,
  getVerification,
  requestVerification,
  revokeVerification,
  type VerificationTarget,
} from './index';
import { KIT_SETUP_TIMEOUT_MS, KIT_TEST_OPTIONS } from './testing/fixtures';

const FACET = 'mind.research';
const STEP_MS = 1000;

describe('verification — BREAK: revoking stacked and shared approvals', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  let ops: UserActor;
  let core: UserActor;
  let member: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
    core = await kit.member({ roles: ['core'] });
    member = await kit.member({ roles: ['trial'] });
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  const skill = (requestedRank: string): VerificationTarget => ({
    type: 'skill',
    facetKey: FACET,
    requestedRank,
  });

  async function request(target: VerificationTarget, evidenceIds: string[] = []) {
    kit.clock.advance(STEP_MS);
    return requestVerification(kit.as(member), { target, evidenceIds });
  }

  async function approve(verifier: UserActor, verificationId: string) {
    kit.clock.advance(STEP_MS);
    return decideVerification(kit.as(verifier), {
      verificationId,
      decision: 'approve',
      note: 'Evidence checks out.',
    });
  }

  async function approveSkill(rank: string) {
    const requested = await request(skill(rank));
    return approve(core, requested.id);
  }

  async function revoke(verifier: UserActor, verificationId: string) {
    kit.clock.advance(STEP_MS);
    await revokeVerification(kit.as(verifier), {
      verificationId,
      reason: 'Evidence was fabricated.',
    });
    const [audit] = await kit.db
      .select({ context: auditLogs.context })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'verification.revoked'), eq(auditLogs.targetId, verificationId)),
      );
    return audit!.context;
  }

  async function verifiedRank() {
    const [row] = await kit.db
      .select({ rank: memberCapabilities.verifiedRank })
      .from(memberCapabilities)
      .where(
        and(
          eq(memberCapabilities.memberId, member.memberId!),
          eq(memberCapabilities.facetKey, FACET),
        ),
      );
    return row?.rank ?? null;
  }

  it('BREAK: stacked skill approvals revoked newest first unwind to no verified rank', async () => {
    const first = await approveSkill('C');
    const second = await approveSkill('B');
    expect(await verifiedRank()).toBe('B');
    expect(await revoke(core, second.id)).toMatchObject({
      reverted: true,
      detail: 'rank_restored',
    });
    expect(await verifiedRank()).toBe('C');
    expect(await revoke(core, first.id)).toMatchObject({ reverted: true, detail: 'rank_restored' });
    expect(await verifiedRank()).toBeNull();
  });

  it('BREAK: stacked skill approvals revoked oldest first never leave a revoked rank', async () => {
    const first = await approveSkill('C');
    const second = await approveSkill('B');
    expect(await revoke(core, first.id)).toMatchObject({
      reverted: false,
      detail: 'rank_held_by_other_verification',
    });
    expect(await verifiedRank()).toBe('B');
    expect(await revoke(core, second.id)).toMatchObject({ reverted: true });
    expect(await verifiedRank()).toBeNull();
  });

  it('BREAK: a revoked middle approval is skipped when the top one is revoked', async () => {
    const bottom = await approveSkill('D');
    const middle = await approveSkill('C');
    const top = await approveSkill('B');
    await revoke(core, middle.id);
    expect(await verifiedRank()).toBe('B');
    await revoke(core, top.id);
    expect(await verifiedRank()).toBe('D');
    await revoke(core, bottom.id);
    expect(await verifiedRank()).toBeNull();
  });

  it('BREAK: a new approval after an unwind stacks cleanly', async () => {
    const first = await approveSkill('C');
    const second = await approveSkill('B');
    await revoke(core, second.id);
    const third = await approveSkill('A');
    expect(await revoke(core, first.id)).toMatchObject({
      reverted: false,
      detail: 'rank_held_by_other_verification',
    });
    await revoke(core, third.id);
    expect(await verifiedRank()).toBeNull();
  });

  it('BREAK: a manual evaluation between approvals is never overwritten', async () => {
    const first = await approveSkill('C');
    kit.clock.advance(STEP_MS);
    const evaluator = await kit.member({ roles: ['core'] });
    await setVerifiedRank(kit.as(evaluator), {
      memberId: member.memberId!,
      facetKey: FACET,
      rank: 'D',
      reason: 'Re-evaluated in person.',
    });
    const second = await approveSkill('B');
    await revoke(core, second.id);
    expect(await verifiedRank()).toBe('D');
    expect(await revoke(core, first.id)).toMatchObject({
      reverted: false,
      detail: 'rank_changed_after_approval',
    });
    expect(await verifiedRank()).toBe('D');
  });

  describe('shared evidence', () => {
    async function sharedSetup() {
      const shared = await submitEvidence(kit.as(member), { title: 'Shared portfolio' });
      const identity = await request({ type: 'identity' }, [shared.id]);
      const skillRequest = await request(skill('C'), [shared.id]);
      const identityApproved = await approve(ops, identity.id);
      const skillApproved = await approve(core, skillRequest.id);
      return { evidenceId: shared.id, identityApproved, skillApproved };
    }

    async function evidenceRow(evidenceId: string) {
      const [row] = await kit.db
        .select({
          status: evidence.status,
          reviewedAt: evidence.reviewedAt,
          reviewedByUserId: evidence.reviewedByUserId,
        })
        .from(evidence)
        .where(eq(evidence.id, evidenceId));
      return row!;
    }

    it('BREAK: stays accepted while another approved verification cites it', async () => {
      const { evidenceId, identityApproved, skillApproved } = await sharedSetup();
      expect(await evidenceRow(evidenceId)).toMatchObject({
        status: 'accepted',
        reviewedAt: identityApproved.decidedAt,
        reviewedByUserId: ops.userId,
      });
      expect(await revoke(ops, identityApproved.id)).toMatchObject({
        evidenceRestored: 0,
        evidenceRetained: 1,
      });
      expect(await evidenceRow(evidenceId)).toEqual({
        status: 'accepted',
        reviewedAt: skillApproved.decidedAt,
        reviewedByUserId: core.userId,
      });
      const stillApproved = await getVerification(kit.as(member), skillApproved.id);
      expect(stillApproved.evidence.map((e) => e.status)).toEqual(['accepted']);

      expect(await revoke(core, skillApproved.id)).toMatchObject({
        evidenceRestored: 1,
        evidenceRetained: 0,
      });
      expect(await evidenceRow(evidenceId)).toEqual({
        status: 'submitted',
        reviewedAt: null,
        reviewedByUserId: null,
      });
    });

    it('BREAK: revoking the later citer first leaves the earlier acceptance alone', async () => {
      const { evidenceId, identityApproved, skillApproved } = await sharedSetup();
      expect(await revoke(core, skillApproved.id)).toMatchObject({
        evidenceRestored: 0,
        evidenceRetained: 0,
      });
      expect(await evidenceRow(evidenceId)).toMatchObject({
        status: 'accepted',
        reviewedAt: identityApproved.decidedAt,
      });
      expect(await revoke(ops, identityApproved.id)).toMatchObject({ evidenceRestored: 1 });
      expect((await evidenceRow(evidenceId)).status).toBe('submitted');
    });
  });
});
