import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, evidence, members, memberRoles, verifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor } from '../permissions/actor';
import { submitEvidence } from '../identity/capabilities.service';
import { resolveUserActor } from '../identity/users.service';
import {
  assignVerifier,
  decideVerification,
  getVerification,
  listVerifications,
  requestVerification,
  revokeVerification,
  startReview,
} from './index';
import { createContribution, createMemberAchievement, createTrialResult } from './testing/fixtures';

async function auditCount(kit: TestKit, action: string, actorUserId?: string) {
  const rows = await kit.db
    .select()
    .from(auditLogs)
    .where(
      actorUserId
        ? and(eq(auditLogs.action, action), eq(auditLogs.actorUserId, actorUserId))
        : eq(auditLogs.action, action),
    );
  return rows.length;
}

describe('verification — BREAK: authorization', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('BREAK: members and moderators cannot decide, and the denial is audited', async () => {
    const subject = await kit.member();
    const peer = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    for (const actor of [peer, mod]) {
      await expect(
        decideVerification(kit.as(actor), {
          verificationId: requested.id,
          decision: 'approve',
          note: 'friend of mine',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await auditCount(kit, 'access.denied', actor.userId)).toBe(1);
    }
    const [row] = await kit.db.select().from(verifications);
    expect(row!.status).toBe('pending');
  });

  it('BREAK: nobody verifies themselves — not even a founder', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    const requested = await requestVerification(kit.as(founder), {
      target: { type: 'skill', facetKey: 'mind.reasoning', requestedRank: 'S' },
    });
    await expect(
      decideVerification(kit.as(founder), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'trust me',
      }),
    ).rejects.toThrow('You cannot verify your own request');
    await expect(
      startReview(kit.as(founder), { verificationId: requested.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assignVerifier(kit.as(founder), {
        verificationId: requested.id,
        verifierMemberId: founder.memberId!,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditCount(kit, 'verification.self_decision_blocked')).toBe(3);
    const [row] = await kit.db.select().from(verifications);
    expect(row).toMatchObject({ status: 'pending', assignedVerifierUserId: null });
  });

  it('BREAK: two-person rule — the staff opener cannot review, decide or route the request', async () => {
    const subject = await kit.member();
    const opener = await kit.member({ roles: ['core'] });
    const other = await kit.member({ roles: ['operations'] });
    const opened = await requestVerification(kit.as(opener), {
      subjectMemberId: subject.memberId!,
      target: { type: 'identity' },
    });
    await expect(
      decideVerification(kit.as(opener), {
        verificationId: opened.id,
        decision: 'approve',
        note: 'I vouch',
      }),
    ).rejects.toThrow(/second verifier/);
    await expect(startReview(kit.as(opener), { verificationId: opened.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      assignVerifier(kit.as(opener), {
        verificationId: opened.id,
        verifierMemberId: other.memberId!,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Nobody can hand the decision back to the opener either.
    await expect(
      assignVerifier(kit.as(other), {
        verificationId: opened.id,
        verifierMemberId: opener.memberId!,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await auditCount(kit, 'verification.two_person_blocked')).toBe(3);
    expect((await resolveUserActor(kit.system, subject.userId)).roles).toEqual(['member']);
  });

  it('BREAK: operations cannot approve skill verifications (canModifyRanks required)', async () => {
    const subject = await kit.member({ roles: ['verified'] });
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), {
      target: { type: 'skill', facetKey: 'life.business', requestedRank: 'A' },
    });
    await expect(
      decideVerification(kit.as(ops), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'looks strong',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [denied] = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, ops.userId)));
    expect(denied!.context).toMatchObject({ capability: 'canModifyRanks' });
    // Nor can ops be assigned as the verifier.
    const lead = await kit.member({ roles: ['core'] });
    await expect(
      assignVerifier(kit.as(lead), {
        verificationId: requested.id,
        verifierMemberId: ops.memberId!,
      }),
    ).rejects.toThrow('That member cannot verify this request.');
  });

  it('BREAK: members and moderators cannot open verifications for someone else', async () => {
    const target = await kit.member();
    for (const roles of [['verified'], ['moderator']] as const) {
      const actor = await kit.member({ roles: [...roles] });
      await expect(
        requestVerification(kit.as(actor), {
          subjectMemberId: target.memberId!,
          target: { type: 'identity' },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await kit.db.select().from(verifications)).toHaveLength(0);
  });

  it('BREAK: IDOR — reading or listing someone else’s verification', async () => {
    const owner = await kit.member();
    const snoop = await kit.member({ roles: ['verified'] });
    const requested = await requestVerification(kit.as(owner), {
      target: { type: 'identity' },
      evidence: [{ title: 'Passport scan link', url: 'https://example.com/private' }],
    });
    await expect(getVerification(kit.as(snoop), requested.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const [denied] = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, snoop.userId)));
    expect(denied!.targetId).toBe(requested.id);
    await expect(
      listVerifications(kit.as(snoop), { subjectMemberId: owner.memberId! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const own = await listVerifications(kit.as(snoop), {});
    expect(own.items).toHaveLength(0);
    // Staff-only filters do not widen a member's view.
    expect((await listVerifications(kit.as(snoop), { unassigned: true })).items).toHaveLength(0);
    await expect(getVerification(kit.as(anonymousActor), requested.id)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(listVerifications(kit.as(anonymousActor))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('BREAK: IDOR — targets and evidence owned by another member', async () => {
    const victim = await kit.member({ roles: ['trial'] });
    const attacker = await kit.member({ roles: ['trial'] });
    const contribution = await createContribution(kit, victim.memberId!);
    const achievement = await createMemberAchievement(kit, victim.memberId!);
    const trial = await createTrialResult(kit, victim.memberId!);
    for (const target of [
      { type: 'contribution' as const, ...contribution },
      { type: 'achievement' as const, ...achievement },
      { type: 'trial' as const, ...trial },
    ]) {
      await expect(requestVerification(kit.as(attacker), { target })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    const stolen = await submitEvidence(kit.as(victim), { title: 'Victim work' });
    await expect(
      requestVerification(kit.as(attacker), {
        target: { type: 'identity' },
        evidenceIds: [stolen.id],
      }),
    ).rejects.toThrow('One or more evidence items were not found.');
    expect(await kit.db.select().from(verifications)).toHaveLength(0);
    const attackerEvidence = await kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.memberId, attacker.memberId!));
    expect(attackerEvidence).toHaveLength(0);
  });

  it('BREAK: only the assigned verifier decides; the subject cannot pick a verifier', async () => {
    const subject = await kit.member();
    const a = await kit.member({ roles: ['operations'] });
    const b = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    await assignVerifier(kit.as(a), {
      verificationId: requested.id,
      verifierMemberId: a.memberId!,
    });
    await expect(
      decideVerification(kit.as(b), {
        verificationId: requested.id,
        decision: 'reject',
        note: 'sniping the decision',
      }),
    ).rejects.toThrow(/assigned to another verifier/);
    await expect(startReview(kit.as(b), { verificationId: requested.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      assignVerifier(kit.as(subject), {
        verificationId: requested.id,
        verifierMemberId: b.memberId!,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      assignVerifier(kit.as(a), {
        verificationId: requested.id,
        verifierMemberId: subject.memberId!,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: nobody revokes a verification about themselves', async () => {
    const staffSubject = await kit.member({ roles: ['operations'] });
    const verifier = await kit.member({ roles: ['operations'] });
    const achievement = await createMemberAchievement(kit, staffSubject.memberId!);
    const requested = await requestVerification(kit.as(staffSubject), {
      target: { type: 'achievement', ...achievement },
    });
    await decideVerification(kit.as(verifier), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Confirmed.',
    });
    await expect(
      revokeVerification(kit.as(staffSubject), { verificationId: requested.id, reason: 'oops' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const member = await kit.member();
    await expect(
      revokeVerification(kit.as(member), { verificationId: requested.id, reason: 'grief' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: quarantined staff lose verification power; quarantined subjects cannot be verified', async () => {
    const subject = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, ops.memberId!));
    const quarantined = await resolveUserActor(kit.system, ops.userId);
    await expect(
      decideVerification(kit.as(quarantined), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'still me',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const other = await kit.member({ roles: ['operations'] });
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, subject.memberId!));
    await expect(
      decideVerification(kit.as(other), {
        verificationId: requested.id,
        decision: 'approve',
        note: 'approve anyway',
      }),
    ).rejects.toThrow('Verification requires a member in good standing.');
    const quarantinedSubject = await resolveUserActor(kit.system, subject.userId);
    await expect(
      requestVerification(kit.as(quarantinedSubject), {
        target: { type: 'skill', facetKey: 'mind.reasoning', requestedRank: 'C' },
      }),
    ).rejects.toThrow('Verification requires a member in good standing.');
    const verifiedRoles = await kit.db
      .select()
      .from(memberRoles)
      .where(and(eq(memberRoles.memberId, subject.memberId!), eq(memberRoles.role, 'verified')));
    expect(verifiedRoles).toHaveLength(0);
  });
});
