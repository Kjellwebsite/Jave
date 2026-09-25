import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { applications, auditLogs, jobs, members, notifications } from '@jave/database';
import { grantRoleUnchecked } from '../identity/roles.service';
import { resolveUserActor } from '../identity/users.service';
import { MINUTE } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import {
  getMyApplication,
  getOrCreateDraft,
  submitApplication,
  updateDraft,
  withdrawApplication,
} from './applicant.service';
import { decideApplication } from './decision.service';
import { APPLICATION_REVIEW_CARD_JOB } from './discord-jobs';
import { APPLICATION_INTERVIEW_REMINDER_JOB } from './keys';
import { getReviewCard } from './review-card.service';
import { reviewApplication, scheduleInterview, startReview } from './review.service';
import { getApplication, listApplications } from './staff-queries.service';
import {
  COMPLETE_DRAFT,
  createReferralCode,
  draftingApplicant,
  PGLITE_SUITE_TIMEOUTS,
  submittedApplicant,
} from './test-fixtures';

vi.setConfig(PGLITE_SUITE_TIMEOUTS);

describe('applications: BREAK', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function deniedCount(userId: string): Promise<number> {
    const rows = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, userId), eq(auditLogs.result, 'denied')));
    return rows.length;
  }

  describe('privilege escalation', () => {
    it('BREAK: a plain member cannot use any staff path, and each denial is audited', async () => {
      const attacker = await kit.member();
      const { applicationId } = await submittedApplicant(kit);
      const as = kit.as(attacker);
      const attempts = [
        () => listApplications(as),
        () => getApplication(as, { applicationId }),
        () => getReviewCard(as, { applicationId }),
        () => startReview(as, { applicationId }),
        () => reviewApplication(as, { applicationId, recommendation: 'accept', score: 5 }),
        () =>
          scheduleInterview(as, {
            applicationId,
            interviewAt: new Date(kit.clock.now().getTime() + 60 * MINUTE),
          }),
        () => decideApplication(as, { applicationId, decision: 'accept', reason: 'let me in' }),
      ];
      for (const attempt of attempts) await expect(attempt()).rejects.toThrow(ForbiddenError);
      expect(await deniedCount(attacker.userId)).toBe(attempts.length);
    });

    it('BREAK: anonymous callers are asked to sign in', async () => {
      const anon = kit.as(anonymousActor);
      await expect(getMyApplication(anon)).rejects.toThrow(UnauthenticatedError);
      await expect(getOrCreateDraft(anon)).rejects.toThrow(UnauthenticatedError);
      await expect(listApplications(anon)).rejects.toThrow(UnauthenticatedError);
    });

    it('BREAK: operations cannot assign other reviewers or take over a claimed review', async () => {
      const opsA = await kit.member({ roles: ['operations'] });
      const opsB = await kit.member({ roles: ['operations'] });
      const { applicationId } = await submittedApplicant(kit);
      await expect(
        startReview(kit.as(opsA), { applicationId, reviewerUserId: opsB.userId }),
      ).rejects.toThrow(ForbiddenError);
      await startReview(kit.as(opsA), { applicationId });
      await expect(startReview(kit.as(opsB), { applicationId })).rejects.toThrow(ForbiddenError);
      const core = await kit.member({ roles: ['core'] });
      const taken = await startReview(kit.as(core), { applicationId });
      expect(taken.assignedReviewerUserId).toBe(core.userId);
    });

    it('BREAK: a misconfigured acceptedRole cannot mint staff', async () => {
      const core = await kit.member({ roles: ['core'] });
      await updateSettings(kit.system, 'applications', { acceptedRole: 'founder' });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score: 5 });
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'friend' }),
      ).rejects.toThrow(/TRIAL or VERIFIED/);
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['applicant']);
    });

    it('BREAK: restricted or quarantined staff lose application powers', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, ops.memberId!));
      const restricted = await resolveUserActor(kit.system, ops.userId);
      await expect(listApplications(kit.as(restricted))).rejects.toThrow(ForbiddenError);
    });

    it('BREAK: quarantined members cannot apply', async () => {
      const member = await kit.member();
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, member.memberId!));
      const quarantined = await resolveUserActor(kit.system, member.userId);
      await expect(getOrCreateDraft(kit.as(quarantined))).rejects.toThrow(ForbiddenError);
    });

    it('BREAK: members already inside JAVELIN cannot apply (no demotion path)', async () => {
      for (const role of ['trial', 'verified', 'moderator'] as const) {
        const insider = await kit.member({ roles: [role] });
        await expect(getOrCreateDraft(kit.as(insider))).rejects.toThrow(InvalidStateError);
      }
    });
  });

  describe('conflict of interest', () => {
    async function applicantPromotedMidFlight(role: 'operations' | 'core') {
      const { applicant, applicationId } = await submittedApplicant(kit);
      await grantRoleUnchecked(kit.system, {
        memberId: applicant.memberId!,
        role,
        reason: 'promoted',
      });
      return { staff: await resolveUserActor(kit.system, applicant.userId), applicationId };
    }

    it('BREAK: a reviewer cannot review, claim or read the staff view of their own application', async () => {
      const { staff, applicationId } = await applicantPromotedMidFlight('operations');
      const as = kit.as(staff);
      await expect(
        reviewApplication(as, { applicationId, recommendation: 'accept', score: 5 }),
      ).rejects.toThrow(/own application/);
      await expect(startReview(as, { applicationId })).rejects.toThrow(ForbiddenError);
      await expect(getApplication(as, { applicationId })).rejects.toThrow(ForbiddenError);
      await expect(getReviewCard(as, { applicationId })).rejects.toThrow(ForbiddenError);
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'application.self_action_blocked'));
      expect(blocked.map((b) => b.context.attempted).sort()).toEqual([
        'review',
        'review_card',
        'start_review',
        'view',
      ]);
    });

    it('BREAK: a decider cannot accept their own application or schedule their own interview', async () => {
      const { staff, applicationId } = await applicantPromotedMidFlight('core');
      const ops = await kit.member({ roles: ['operations'] });
      await startReview(kit.as(ops), { applicationId });
      await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 5 });
      await expect(
        decideApplication(kit.as(staff), { applicationId, decision: 'accept', reason: 'myself' }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        scheduleInterview(kit.as(staff), {
          applicationId,
          interviewAt: new Date(kit.clock.now().getTime() + 60 * MINUTE),
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('BREAK: a promoted applicant never sees their own application in the staff list', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { staff, applicationId } = await applicantPromotedMidFlight('operations');
      const other = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      const [own] = await kit.db
        .select({ number: applications.number })
        .from(applications)
        .where(eq(applications.id, applicationId));

      const list = await listApplications(kit.as(staff));
      expect(list.items.map((item) => item.id)).toEqual([other.applicationId]);
      expect(list.total).toBe(1);
      const byNumber = await listApplications(kit.as(staff), { number: own!.number });
      expect(byNumber).toMatchObject({ items: [], total: 0 });
      const assigned = await listApplications(kit.as(staff), { status: 'review' });
      expect(assigned.items).toEqual([]);
      // Other staff still see it.
      expect((await listApplications(kit.as(core))).total).toBe(2);
    });

    it('BREAK: the applicant cannot be assigned as their own reviewer', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { staff, applicationId } = await applicantPromotedMidFlight('operations');
      await expect(
        startReview(kit.as(core), { applicationId, reviewerUserId: staff.userId }),
      ).rejects.toThrow(ValidationError);
    });

    it('BREAK: self-referral is rejected', async () => {
      const { applicant } = await draftingApplicant(kit);
      await createReferralCode(kit, applicant, 'MYSELF');
      await expect(updateDraft(kit.as(applicant), { referralCode: 'MYSELF' })).rejects.toThrow(
        /your own referral code/,
      );
    });
  });

  describe('IDOR and mass assignment', () => {
    it('BREAK: applicant functions accept no application id and no staff fields', async () => {
      const victim = await submittedApplicant(kit);
      const { applicant } = await draftingApplicant(kit);
      for (const injected of [
        { applicationId: victim.applicationId },
        { status: 'accepted' },
        { decisionReason: 'x' },
        { userId: victim.applicant.userId },
        { assignedReviewerUserId: applicant.userId },
      ]) {
        await expect(updateDraft(kit.as(applicant), injected as never)).rejects.toThrow(
          ValidationError,
        );
      }
      const [row] = await kit.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, victim.applicationId));
      expect(row!.status).toBe('submitted');
    });

    it('BREAK: withdrawing only ever touches the caller’s own application', async () => {
      const victim = await submittedApplicant(kit);
      const attacker = await kit.member();
      await expect(
        withdrawApplication(kit.as(attacker), { applicationId: victim.applicationId } as never),
      ).rejects.toThrow(ValidationError);
      await expect(withdrawApplication(kit.as(attacker))).rejects.toThrow(NotFoundError);
      const [row] = await kit.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, victim.applicationId));
      expect(row!.status).toBe('submitted');
    });

    it('BREAK: staff cannot read or list drafts', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { applicationId } = await draftingApplicant(kit);
      await expect(getApplication(kit.as(ops), { applicationId })).rejects.toThrow(NotFoundError);
      expect((await listApplications(kit.as(ops))).total).toBe(0);
      await expect(listApplications(kit.as(ops), { status: 'draft' } as never)).rejects.toThrow(
        ValidationError,
      );
    });

    it('BREAK: malformed ids are validation errors, unknown ids are not found', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await expect(getApplication(kit.as(ops), { applicationId: "1' OR '1'='1" })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        getApplication(kit.as(ops), { applicationId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('malformed and huge input', () => {
    it('BREAK: oversized fields, NUL bytes and hostile URLs are rejected before storage', async () => {
      const { applicant } = await draftingApplicant(kit);
      const as = kit.as(applicant);
      await expect(updateDraft(as, { motivation: 'x'.repeat(2001) })).rejects.toThrow(
        ValidationError,
      );
      await expect(updateDraft(as, { references: 'x'.repeat(1001) })).rejects.toThrow(
        ValidationError,
      );
      await expect(updateDraft(as, { experience: 'x'.repeat(1_000_000) })).rejects.toThrow(
        ValidationError,
      );
      await expect(updateDraft(as, { projects: 'nul\u0000byte' })).rejects.toThrow(ValidationError);
      await expect(updateDraft(as, { portfolioUrl: 'javascript:alert(1)' })).rejects.toThrow(
        ValidationError,
      );
      await expect(
        updateDraft(as, { evidenceLinks: ['https://ok.dev', 'data:text/html,<b>x</b>'] }),
      ).rejects.toThrow(ValidationError);
      await expect(updateDraft(as, { evidenceLinks: 'x'.repeat(5000) })).rejects.toThrow(
        /at most 4000/,
      );
      await expect(updateDraft(as, { referralCode: "'; drop table users; --" })).rejects.toThrow(
        ValidationError,
      );
    });

    it('BREAK: markup-shaped text is stored verbatim (escaping is the surface’s job)', async () => {
      const { applicant } = await draftingApplicant(kit);
      const hostile = '<script>alert(1)</script> @everyone **bold** [x](https://evil.test)';
      const view = await updateDraft(kit.as(applicant), { projects: hostile });
      expect(view.projects).toBe(hostile);
    });

    it('BREAK: review scores outside 1–5 and invalid interview dates are rejected', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      for (const score of [0, 6, 2.5, -1]) {
        await expect(
          reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score }),
        ).rejects.toThrow(ValidationError);
      }
      await startReview(kit.as(core), { applicationId });
      await expect(
        scheduleInterview(kit.as(core), { applicationId, interviewAt: 'not a date' }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('invalid transitions', () => {
    it('BREAK: closed applications cannot be reviewed, rescheduled or decided again', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await withdrawApplication(kit.as(applicant));
      await expect(
        reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score: 5 }),
      ).rejects.toThrow(InvalidStateError);
      await expect(startReview(kit.as(core), { applicationId })).rejects.toThrow(InvalidStateError);
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'reject', reason: 'late' }),
      ).rejects.toThrow(InvalidStateError);
      await expect(withdrawApplication(kit.as(applicant))).rejects.toThrow(NotFoundError);
    });
  });

  describe('duplicates and races', () => {
    it('BREAK: parallel draft creation converges on one row', async () => {
      const applicant = await kit.member();
      const results = await Promise.all([
        getOrCreateDraft(kit.as(applicant)),
        getOrCreateDraft(kit.as(applicant)),
        getOrCreateDraft(kit.as(applicant)),
      ]);
      expect(new Set(results.map((r) => r.application.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const rows = await kit.db
        .select()
        .from(applications)
        .where(eq(applications.userId, applicant.userId));
      expect(rows).toHaveLength(1);
    });

    it('BREAK: a double submit succeeds once', async () => {
      const { applicant } = await draftingApplicant(kit);
      const results = await Promise.allSettled([
        submitApplication(kit.as(applicant)),
        submitApplication(kit.as(applicant)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(InvalidStateError);
    });

    it('BREAK: a submit/withdraw loop cannot spam reviewers or the review channel', async () => {
      const reviewers = [
        await kit.member({ roles: ['operations'] }),
        await kit.member({ roles: ['core'] }),
      ];
      const { applicant } = await submittedApplicant(kit);
      for (let round = 0; round < 3; round++) {
        const me = await resolveUserActor(kit.system, applicant.userId);
        await withdrawApplication(kit.as(me));
        const again = await resolveUserActor(kit.system, applicant.userId);
        await getOrCreateDraft(kit.as(again));
        await updateDraft(kit.as(again), COMPLETE_DRAFT);
        await expect(submitApplication(kit.as(again))).rejects.toThrow(/apply again from/);
        kit.clock.advance(MINUTE);
      }
      for (const reviewer of reviewers) {
        const received = await kit.db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientUserId, reviewer.userId),
              eq(notifications.title, 'APPLICATION RECEIVED'),
            ),
          );
        expect(received).toHaveLength(1);
      }
      const cards = await kit.db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_REVIEW_CARD_JOB));
      // One card: posted on submission, updated on the single withdrawal.
      expect(new Set(cards.map((card) => card.payload.applicationId)).size).toBe(1);
      expect(cards.map((card) => card.payload.revision).sort()).toEqual([1, 2]);
    });

    it('BREAK: competing decisions — exactly one wins and roles stay consistent', async () => {
      const coreA = await kit.member({ roles: ['core'] });
      const coreB = await kit.member({ roles: ['core'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await reviewApplication(kit.as(coreA), { applicationId, recommendation: 'accept', score: 4 });
      const results = await Promise.allSettled([
        decideApplication(kit.as(coreA), {
          applicationId,
          decision: 'accept',
          reason: 'Strong evidence.',
        }),
        decideApplication(kit.as(coreB), {
          applicationId,
          decision: 'reject',
          reason: 'Thin evidence.',
        }),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      expect(won).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect([InvalidStateError, ConflictError].some((E) => lost.reason instanceof E)).toBe(true);
      const roles = (await resolveUserActor(kit.system, applicant.userId)).roles;
      const [row] = await kit.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId));
      expect(roles).toEqual(row!.status === 'accepted' ? ['trial'] : ['member']);
    });

    it('BREAK: a stale reassignment loses instead of overwriting', async () => {
      const core = await kit.member({ roles: ['core'] });
      const opsA = await kit.member({ roles: ['operations'] });
      const opsB = await kit.member({ roles: ['operations'] });
      const { applicationId } = await submittedApplicant(kit);
      const results = await Promise.allSettled([
        startReview(kit.as(core), { applicationId, reviewerUserId: opsA.userId }),
        startReview(kit.as(core), { applicationId, reviewerUserId: opsB.userId }),
      ]);
      // Both pre-checks saw an unassigned application; the second write must not pass silently.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictError);
      const [row] = await kit.db
        .select({ reviewer: applications.assignedReviewerUserId })
        .from(applications)
        .where(eq(applications.id, applicationId));
      expect([opsA.userId, opsB.userId]).toContain(row!.reviewer);
    });
  });

  describe('time edges', () => {
    it('BREAK: the interview lead-time boundary is exact', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      const now = kit.clock.now().getTime();
      await expect(
        scheduleInterview(kit.as(core), {
          applicationId,
          interviewAt: new Date(now + 15 * MINUTE - 1),
        }),
      ).rejects.toThrow(ValidationError);
      const ok = await scheduleInterview(kit.as(core), {
        applicationId,
        interviewAt: new Date(now + 15 * MINUTE),
      });
      expect(ok.status).toBe('interview');
    });

    it('BREAK: a reminder is not scheduled in the past for a near interview', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      await scheduleInterview(kit.as(core), {
        applicationId,
        interviewAt: new Date(kit.clock.now().getTime() + 30 * MINUTE),
      });
      const outcomes = await kit.drain({});
      expect(outcomes).toEqual([]);
      const reminders = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      expect(reminders).toHaveLength(0);
    });

    it('BREAK: moving an interview while its old reminder is running keeps the new reminder', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      const first = new Date(kit.clock.now().getTime() + 48 * 60 * MINUTE);
      await scheduleInterview(kit.as(core), { applicationId, interviewAt: first });
      // Simulate a worker holding the old reminder mid-run.
      await kit.db
        .update(jobs)
        .set({ status: 'running' })
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      const moved = new Date(first.getTime() + 24 * 60 * MINUTE);
      await scheduleInterview(kit.as(core), { applicationId, interviewAt: moved });
      const reminders = await kit.db
        .select({ status: jobs.status, payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      const pending = reminders.filter((r) => r.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.payload.interviewAt).toBe(moved.toISOString());
    });
  });
});
