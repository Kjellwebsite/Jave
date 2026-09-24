import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  evidence,
  jobs,
  memberCapabilities,
  notificationDeliveries,
  notifications,
  rankHistory,
  verifications,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY } from '../kernel/clock';
import { UnauthenticatedError } from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import { submitEvidence } from '../identity/capabilities.service';
import { resolveUserActor } from '../identity/users.service';
import { systemActor } from '../permissions/actor';
import { coreJobHandlers, coreRecurringJobs } from '../registry';
import {
  assignVerifier,
  decideVerification,
  getVerification,
  jobHandlers,
  listVerifications,
  recurringJobs,
  requestVerification,
  startReview,
  VERIFICATION_EXPIRE_JOB,
} from './index';
import { createTrialResult, KIT_SETUP_TIMEOUT_MS, KIT_TEST_OPTIONS } from './testing/fixtures';

async function eventsOf(kit: TestKit, type: string) {
  return kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));
}

async function auditCountOf(kit: TestKit, action: string) {
  return (await kit.db.select().from(auditLogs).where(eq(auditLogs.action, action))).length;
}

async function notificationsFor(kit: TestKit, userId: string) {
  return kit.db.select().from(notifications).where(eq(notifications.recipientUserId, userId));
}

describe('verification lifecycle', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('a member requests a skill verification with new and existing evidence', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const existing = await submitEvidence(kit.as(member), {
      title: 'Replication study',
      url: 'https://example.com/study',
    });
    const detail = await requestVerification(kit.as(member), {
      target: { type: 'skill', facetKey: 'mind.research', requestedRank: 'B' },
      claim: 'I replicate papers end to end.',
      evidence: [{ title: 'Preprint', url: 'https://example.com/preprint', description: 'v2' }],
      evidenceIds: [existing.id],
    });

    expect(detail).toMatchObject({
      reference: expect.stringMatching(/^VER-\d{4}$/),
      type: 'skill',
      status: 'pending',
      claim: 'I replicate papers end to end.',
      targetLabel: 'Research',
      facetKey: 'mind.research',
      requestedRank: 'B',
      openedBy: 'subject',
      evidenceCount: 2,
      staff: null,
      assignedVerifier: null,
    });
    expect(detail.expiresAt!.getTime() - detail.requestedAt.getTime()).toBe(30 * DAY);
    expect(detail.evidence.map((e) => e.title).sort()).toEqual(['Preprint', 'Replication study']);
    const created = detail.evidence.find((e) => e.title === 'Preprint')!;
    expect(created).toMatchObject({ kind: 'link', status: 'submitted' });

    const [event] = await eventsOf(kit, 'verification.requested');
    expect(event).toMatchObject({ subjectMemberId: member.memberId, aggregateId: detail.id });
    expect(await eventsOf(kit, 'evidence.submitted')).toHaveLength(2);
    const audit = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification.requested'));
    expect(audit[0]!.context).toMatchObject({ openedFor: 'self', evidenceCount: 2 });
    // No queue channel configured: no Discord card job.
    const cards = await kit.db
      .select()
      .from(jobs)
      .where(eq(jobs.type, 'discord.verification.queue_card'));
    expect(cards).toHaveLength(0);
  });

  it('uses a descriptive default claim', async () => {
    const member = await kit.member();
    const detail = await requestVerification(kit.as(member), { target: { type: 'identity' } });
    expect(detail.claim).toBe('Identity confirmed within JAVELIN.');
    expect(detail.targetLabel).toMatch(/^@/);
  });

  it('full path: queue → assign → review → approve with a different rank', async () => {
    const member = await kit.member({ roles: ['verified'] });
    const ops = await kit.member({ roles: ['operations'] });
    const evaluator = await kit.member({ roles: ['core'] });
    const requested = await requestVerification(kit.as(member), {
      target: { type: 'skill', facetKey: 'create.technical', requestedRank: 'B' },
      evidence: [{ title: 'Compiler', url: 'https://example.com/compiler' }],
    });

    const queue = await listVerifications(kit.as(ops), { status: ['pending'], sort: 'oldest' });
    expect(queue.items.map((i) => i.id)).toEqual([requested.id]);
    expect(queue.total).toBe(1);

    await assignVerifier(kit.as(ops), {
      verificationId: requested.id,
      verifierMemberId: evaluator.memberId!,
    });
    const [assigned] = await notificationsFor(kit, evaluator.userId);
    expect(assigned).toMatchObject({
      type: 'verification.assigned',
      title: 'VERIFICATION ASSIGNED',
    });

    const mine = await listVerifications(kit.as(evaluator), { assignedToMe: true });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]!.assignedVerifier?.userId).toBe(evaluator.userId);

    const reviewing = await startReview(kit.as(evaluator), { verificationId: requested.id });
    expect(reviewing.status).toBe('in_review');
    // Idempotent for the same reviewer.
    expect((await startReview(kit.as(evaluator), { verificationId: requested.id })).status).toBe(
      'in_review',
    );

    kit.clock.advance(60_000);
    const decided = await decideVerification(kit.as(evaluator), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Shipped compiler with tests; strong beyond B.',
      grantedRank: 'A',
    });
    expect(decided).toMatchObject({ status: 'approved', grantedRank: 'A', requestedRank: 'B' });
    expect(decided.staff?.verifier?.userId).toBe(evaluator.userId);
    expect(decided.staff?.outcome).toMatchObject({
      kind: 'rank',
      previousRank: null,
      grantedRank: 'A',
    });

    const [capability] = await kit.db
      .select()
      .from(memberCapabilities)
      .where(eq(memberCapabilities.memberId, member.memberId!));
    expect(capability!.verifiedRank).toBe('A');
    const [history] = await kit.db
      .select()
      .from(rankHistory)
      .where(eq(rankHistory.memberId, member.memberId!));
    expect(history).toMatchObject({ source: 'verification', sourceRef: requested.id, toRank: 'A' });

    // Evidence reviewed with the decision.
    const [ev] = await kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.memberId, member.memberId!));
    expect(ev!.status).toBe('accepted');

    const approvedEvents = await eventsOf(kit, 'verification.approved');
    expect(approvedEvents[0]!.payload).toMatchObject({ grantedRank: 'A', type: 'skill' });
    const decisionAudit = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification.approved'));
    expect(decisionAudit[0]).toMatchObject({ actorUserId: evaluator.userId, result: 'success' });

    // The subject hears once by DM (rank.updated); the verification notice is inbox-only.
    const subjectNotes = await notificationsFor(kit, member.userId);
    const completed = subjectNotes.find((n) => n.type === 'verification.completed')!;
    expect(completed.title).toBe('VERIFICATION APPROVED');
    expect(completed.body).toContain('Verified at A.');
    expect(subjectNotes.some((n) => n.type === 'rank.updated')).toBe(true);
    const deliveries = await kit.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, completed.id));
    expect(deliveries).toHaveLength(0);
  });

  it('rejects with a note the subject sees, changing nothing else', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(member), { target: { type: 'identity' } });
    const decided = await decideVerification(kit.as(ops), {
      verificationId: requested.id,
      decision: 'reject',
      note: 'Link your public work first.',
    });
    expect(decided.status).toBe('rejected');
    expect(decided.grantedRank).toBeNull();
    const actor = await resolveUserActor(kit.system, member.userId);
    expect(actor.roles).toEqual(['trial']);
    const view = await getVerification(kit.as(member), requested.id);
    expect(view.decisionNote).toBe('Link your public work first.');
    expect(view.staff).toBeNull();
    const [note] = await notificationsFor(kit, member.userId);
    expect(note).toMatchObject({ type: 'verification.completed', title: 'VERIFICATION REJECTED' });
    expect(note!.body).toContain('Note: Link your public work first.');
    expect(await eventsOf(kit, 'verification.rejected')).toHaveLength(1);
  });

  it('staff open a request for a member; a second verifier decides', async () => {
    const member = await kit.member();
    const opener = await kit.member({ roles: ['operations'] });
    const second = await kit.member({ roles: ['operations'] });
    const opened = await requestVerification(kit.as(opener), {
      subjectMemberId: member.memberId!,
      target: { type: 'identity' },
      claim: 'Confirmed in person at the Berlin meetup.',
    });
    expect(opened.openedBy).toBe('staff');
    expect(opened.staff?.requestedBy?.userId).toBe(opener.userId);
    const decided = await decideVerification(kit.as(second), {
      verificationId: opened.id,
      decision: 'approve',
      note: 'Second confirmation via video call.',
    });
    expect(decided.status).toBe('approved');
    const actor = await resolveUserActor(kit.system, member.userId);
    expect(actor.roles).toEqual(['verified']);
    // The subject can see a verification opened on their behalf.
    const own = await listVerifications(kit.as(member));
    expect(own.items.map((i) => i.id)).toEqual([opened.id]);
  });

  it('a system or integration actor opens a request; any user verifier decides it', async () => {
    const member = await kit.member({ roles: ['trial'] });
    const ops = await kit.member({ roles: ['operations'] });
    const integration = kit.as({
      kind: 'integration',
      integrationId: 'trials-sync',
      provider: 'internal',
      capabilities: new Set(['canVerifyMembers'] as const),
    });
    const { trialResultId } = await createTrialResult(kit, member.memberId!);
    const openers = [
      {
        ctx: kit.as(systemActor('trials')),
        target: { type: 'trial' as const, trialResultId },
      },
      { ctx: integration, target: { type: 'identity' as const } },
    ];
    for (const { ctx, target } of openers) {
      const opened = await requestVerification(ctx, { subjectMemberId: member.memberId!, target });
      expect(opened.openedBy).toBe('system');
      expect(opened.staff?.requestedBy).toBeNull();
      const [row] = await kit.db
        .select({ requestedByUserId: verifications.requestedByUserId })
        .from(verifications)
        .where(eq(verifications.id, opened.id));
      expect(row!.requestedByUserId).toBeNull();
      await startReview(kit.as(ops), { verificationId: opened.id });
      const decided = await decideVerification(kit.as(ops), {
        verificationId: opened.id,
        decision: 'approve',
        note: 'Result confirmed.',
      });
      expect(decided).toMatchObject({ status: 'approved', openedBy: 'system' });
      expect(decided.staff?.verifier?.userId).toBe(ops.userId);
    }
    expect(await auditCountOf(kit, 'verification.two_person_blocked')).toBe(0);
    expect((await resolveUserActor(kit.system, member.userId)).roles).toEqual(['verified']);
    // Integrations are not people: requesting without a subject has no "self" to fall back on.
    await expect(
      requestVerification(integration, { target: { type: 'identity' } }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('unassigning an in-review verification returns it to pending', async () => {
    const member = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const lead = await kit.member({ roles: ['core'] });
    const requested = await requestVerification(kit.as(member), { target: { type: 'identity' } });
    await startReview(kit.as(ops), { verificationId: requested.id });
    const reset = await assignVerifier(kit.as(lead), {
      verificationId: requested.id,
      verifierMemberId: null,
    });
    expect(reset.status).toBe('pending');
    expect(reset.assignedVerifier).toBeNull();
    const [row] = await kit.db.select().from(verifications);
    expect(row!.reviewStartedAt).toBeNull();
  });

  it('filters the staff queue by type, status and assignment', async () => {
    const a = await kit.member();
    const b = await kit.member({ roles: ['trial'] });
    const ops = await kit.member({ roles: ['operations'] });
    await requestVerification(kit.as(a), { target: { type: 'identity' } });
    kit.clock.advance(1000);
    const skill = await requestVerification(kit.as(b), {
      target: { type: 'skill', facetKey: 'mind.reasoning', requestedRank: 'C' },
    });
    const bySkill = await listVerifications(kit.as(ops), { type: 'skill' });
    expect(bySkill.items.map((i) => i.id)).toEqual([skill.id]);
    const newest = await listVerifications(kit.as(ops), { sort: 'newest' });
    expect(newest.items[0]!.id).toBe(skill.id);
    const unassigned = await listVerifications(kit.as(ops), {
      unassigned: true,
      status: 'pending',
    });
    expect(unassigned.total).toBe(2);
    const bySubject = await listVerifications(kit.as(ops), { subjectMemberId: a.memberId! });
    expect(bySubject.total).toBe(1);
    const paged = await listVerifications(kit.as(ops), { limit: 1, offset: 1, sort: 'oldest' });
    expect(paged.items.map((i) => i.id)).toEqual([skill.id]);
    expect(paged.total).toBe(2);
  });
});

describe('verification expiry', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('is registered as a recurring job and a handler', () => {
    expect(recurringJobs.map((j) => j.type)).toEqual([VERIFICATION_EXPIRE_JOB]);
    expect(coreRecurringJobs.some((j) => j.type === VERIFICATION_EXPIRE_JOB)).toBe(true);
    expect(Object.keys(coreJobHandlers())).toContain(VERIFICATION_EXPIRE_JOB);
  });

  it('expires pending and in-review verifications at expiresAt, never decided ones', async () => {
    const a = await kit.member();
    const b = await kit.member({ roles: ['trial'] });
    const c = await kit.member({ roles: ['applicant'] });
    const ops = await kit.member({ roles: ['operations'] });
    const pending = await requestVerification(kit.as(a), { target: { type: 'identity' } });
    const reviewing = await requestVerification(kit.as(b), { target: { type: 'identity' } });
    await startReview(kit.as(ops), { verificationId: reviewing.id });
    const decided = await requestVerification(kit.as(c), { target: { type: 'identity' } });
    await decideVerification(kit.as(ops), {
      verificationId: decided.id,
      decision: 'reject',
      note: 'Not enough yet.',
    });

    kit.clock.advance(30 * DAY - 1);
    await enqueueJob(kit.system, VERIFICATION_EXPIRE_JOB);
    const early = await kit.drain(jobHandlers);
    expect(early[0]).toMatchObject({ status: 'completed', result: { expired: 0, failed: 0 } });

    kit.clock.advance(1);
    await enqueueJob(kit.system, VERIFICATION_EXPIRE_JOB);
    const due = await kit.drain(jobHandlers);
    expect(due[0]).toMatchObject({ status: 'completed', result: { expired: 2, failed: 0 } });

    const statuses = Object.fromEntries(
      (await kit.db.select().from(verifications)).map((v) => [v.id, v.status]),
    );
    expect(statuses).toEqual({
      [pending.id]: 'expired',
      [reviewing.id]: 'expired',
      [decided.id]: 'rejected',
    });
    expect(await eventsOf(kit, 'verification.expired')).toHaveLength(2);
    const [note] = await kit.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientUserId, a.userId),
          eq(notifications.type, 'verification.completed'),
        ),
      );
    expect(note!.title).toBe('VERIFICATION EXPIRED');
    expect(note!.body).toContain('No decision within 30 days.');
    const audit = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'verification.expired'));
    expect(audit).toHaveLength(2);
    expect(audit[0]!.actorType).toBe('system');

    // A new request is possible once the old one expired.
    const again = await requestVerification(kit.as(a), { target: { type: 'identity' } });
    expect(again.status).toBe('pending');
  });
});
