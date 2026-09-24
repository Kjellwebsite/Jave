import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { applicationReviews, auditLogs, domainEvents, jobs, notifications } from '@jave/database';
import { resolveUserActor } from '../identity/users.service';
import { HOUR, MINUTE } from '../kernel/clock';
import { ForbiddenError, InvalidStateError, ValidationError } from '../kernel/errors';
import { createTestKit, type TestKit } from '../testing';
import { getMyApplication, submitApplication } from './applicant.service';
import { decideApplication } from './decision.service';
import { APPLICATION_INTERVIEW_REMINDER_JOB } from './keys';
import { reviewApplication, scheduleInterview, startReview } from './review.service';
import { getApplication, listApplications } from './staff-queries.service';
import {
  COMPLETE_DRAFT,
  createReferralCode,
  draftingApplicant,
  setApplicationSettings,
  submittedApplicant,
} from './test-fixtures';

describe('applications: staff workflow', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  describe('listing and reading', () => {
    it('lists submitted applications with filters and pagination; drafts stay private', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await draftingApplicant(kit);
      const a = await submittedApplicant(kit);
      kit.clock.advance(MINUTE);
      const b = await submittedApplicant(kit);
      await startReview(kit.as(ops), { applicationId: b.applicationId });

      const all = await listApplications(kit.as(ops));
      expect(all.total).toBe(2);
      expect(all.items.map((i) => i.id)).toEqual([a.applicationId, b.applicationId]);
      expect(all.items[0]!.applicant?.userId).toBe(a.applicant.userId);
      expect(all.items[0]).not.toHaveProperty('references');

      const newest = await listApplications(kit.as(ops), { sort: 'newest', limit: 1 });
      expect(newest.items.map((i) => i.id)).toEqual([b.applicationId]);
      expect(newest.total).toBe(2);

      const inReview = await listApplications(kit.as(ops), { status: 'review' });
      expect(inReview.items.map((i) => i.id)).toEqual([b.applicationId]);
      expect(inReview.items[0]!.assignedReviewer?.userId).toBe(ops.userId);

      const mine = await listApplications(kit.as(ops), { assignedToMe: true });
      expect(mine.items.map((i) => i.id)).toEqual([b.applicationId]);

      const byDomain = await listApplications(kit.as(ops), { domainKey: 'MIND' });
      expect(byDomain.total).toBe(0);

      const byNumber = await listApplications(kit.as(ops), { number: all.items[1]!.number });
      expect(byNumber.items.map((i) => i.id)).toEqual([b.applicationId]);
    });

    it('returns the full staff view and audits the read', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const referrer = await kit.member();
      await createReferralCode(kit, referrer, 'REF1');
      const { applicant, applicationId } = await draftingApplicant(kit, {
        ...COMPLETE_DRAFT,
        referralCode: 'REF1',
      });
      await submitApplication(kit.as(applicant));
      await reviewApplication(kit.as(ops), {
        applicationId,
        recommendation: 'interview',
        score: 4,
        note: 'Strong portfolio; probe depth.',
      });

      const view = await getApplication(kit.as(ops), { applicationId });
      expect(view.references).toBe(COMPLETE_DRAFT.references);
      expect(view.referral).toEqual({
        code: 'REF1',
        owner: expect.objectContaining({ userId: referrer.userId }),
      });
      expect(view.reviews).toHaveLength(1);
      expect(view.reviews[0]!.reviewer?.userId).toBe(ops.userId);
      expect(view.tally.interview).toBe(1);
      expect(view.history.map((h) => h.to)).toEqual(['draft', 'submitted', 'review']);
      expect(view.history[2]!.actor?.userId).toBe(ops.userId);

      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'application.viewed'), eq(auditLogs.targetId, applicationId)),
        );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorUserId).toBe(ops.userId);
    });
  });

  describe('review', () => {
    it('claims for review and notifies the applicant', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      const summary = await startReview(kit.as(ops), { applicationId });
      expect(summary).toMatchObject({ status: 'review', assignedReviewerUserId: ops.userId });
      const again = await startReview(kit.as(ops), { applicationId });
      expect(again.status).toBe('review');
      const inbox = await kit.db
        .select({ title: notifications.title })
        .from(notifications)
        .where(eq(notifications.recipientUserId, applicant.userId));
      expect(inbox.map((n) => n.title)).toContain('APPLICATION IN REVIEW');
    });

    it('lets a decider assign another eligible reviewer', async () => {
      const core = await kit.member({ roles: ['core'] });
      const ops = await kit.member({ roles: ['operations'] });
      const outsider = await kit.member({ roles: ['verified'] });
      const { applicationId } = await submittedApplicant(kit);
      await expect(
        startReview(kit.as(core), { applicationId, reviewerUserId: outsider.userId }),
      ).rejects.toThrow(ValidationError);
      const summary = await startReview(kit.as(core), {
        applicationId,
        reviewerUserId: ops.userId,
      });
      expect(summary.assignedReviewerUserId).toBe(ops.userId);
      const inbox = await kit.db
        .select({ title: notifications.title })
        .from(notifications)
        .where(eq(notifications.recipientUserId, ops.userId));
      expect(inbox.map((n) => n.title)).toContain('APPLICATION ASSIGNED');
    });

    it('upserts one review per reviewer and moves SUBMITTED to REVIEW', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { applicationId } = await submittedApplicant(kit);
      const first = await reviewApplication(kit.as(ops), {
        applicationId,
        recommendation: 'reject',
        score: 2,
      });
      expect(first).toMatchObject({ updated: false, status: 'review' });
      const second = await reviewApplication(kit.as(ops), {
        applicationId,
        recommendation: 'accept',
        score: 5,
        note: 'Changed my mind after the portfolio.',
      });
      expect(second.updated).toBe(true);
      const rows = await kit.db
        .select()
        .from(applicationReviews)
        .where(eq(applicationReviews.applicationId, applicationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recommendation: 'accept', score: 5 });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'application.reviewed'));
      expect(events).toHaveLength(2);
    });
  });

  describe('interviews', () => {
    it('schedules, reschedules and keeps one reminder job', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      const at = new Date(kit.clock.now().getTime() + 48 * HOUR);
      const scheduled = await scheduleInterview(kit.as(core), {
        applicationId,
        interviewAt: at,
        applicantMessage: 'Voice channel: Interviews.',
      });
      expect(scheduled).toMatchObject({ status: 'interview', interviewAt: at });
      const later = new Date(at.getTime() + 24 * HOUR);
      await scheduleInterview(kit.as(core), { applicationId, interviewAt: later.toISOString() });

      const reminders = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      expect(reminders.map((j) => j.status).sort()).toEqual(['cancelled', 'pending']);
      const live = reminders.find((j) => j.status === 'pending')!;
      expect(live.runAt.toISOString()).toBe(new Date(later.getTime() - HOUR).toISOString());

      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, applicant.userId));
      const invite = inbox.find((n) => n.title === 'INTERVIEW SCHEDULED')!;
      expect(invite.body).toContain('2026-03-03 12:00 UTC');
      expect(invite.body).toContain('Voice channel: Interviews.');
      expect(inbox.map((n) => n.title)).toContain('INTERVIEW MOVED');
      const mine = await getMyApplication(kit.as(applicant));
      expect(mine.application?.interviewAt?.toISOString()).toBe(later.toISOString());
    });

    it('requires review first and a time inside the window', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      const tomorrow = new Date(kit.clock.now().getTime() + 24 * HOUR);
      await expect(
        scheduleInterview(kit.as(core), { applicationId, interviewAt: tomorrow }),
      ).rejects.toThrow(InvalidStateError);
      await startReview(kit.as(core), { applicationId });
      await expect(
        scheduleInterview(kit.as(core), {
          applicationId,
          interviewAt: new Date(kit.clock.now().getTime() + 5 * MINUTE),
        }),
      ).rejects.toThrow(/15 minutes/);
      await expect(
        scheduleInterview(kit.as(core), {
          applicationId,
          interviewAt: new Date(kit.clock.now().getTime() - HOUR),
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        scheduleInterview(kit.as(core), {
          applicationId,
          interviewAt: new Date(kit.clock.now().getTime() + 91 * 24 * HOUR),
        }),
      ).rejects.toThrow(/90 days/);
    });
  });

  describe('decisions', () => {
    async function reviewed(kitRef: TestKit) {
      const core = await kitRef.member({ roles: ['core'] });
      const ops = await kitRef.member({ roles: ['operations'] });
      const drafted = await submittedApplicant(kitRef);
      await reviewApplication(kitRef.as(ops), {
        applicationId: drafted.applicationId,
        recommendation: 'accept',
        score: 5,
        note: 'REVIEWER-NOTE-SECRET',
      });
      return { core, ops, ...drafted };
    }

    it('accepts: grants TRIAL, publishes, and tells the applicant only the safe message', async () => {
      const { core, ops, applicant, applicationId } = await reviewed(kit);
      const result = await decideApplication(kit.as(core), {
        applicationId,
        decision: 'accept',
        reason: 'INTERNAL-REASON-SECRET',
        applicantMessage: 'Welcome. Your first trial starts next week.',
      });
      expect(result).toMatchObject({ status: 'accepted', grantedRole: 'trial' });
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['trial']);

      const [accepted] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'application.accepted'));
      expect(accepted!.subjectMemberId).toBe(applicant.memberId);
      expect(JSON.stringify(accepted!.payload)).not.toContain('INTERNAL-REASON-SECRET');

      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, applicant.userId));
      const decision = inbox.find((n) => n.title === 'APPLICATION ACCEPTED')!;
      expect(decision.body).toContain('You are now TRIAL.');
      expect(decision.body).toContain('Your first trial starts next week.');
      const everything = JSON.stringify(inbox);
      expect(everything).not.toContain('INTERNAL-REASON-SECRET');
      expect(everything).not.toContain('REVIEWER-NOTE-SECRET');

      const mine = JSON.stringify(await getMyApplication(kit.as(actor)));
      expect(mine).toContain('Your first trial starts next week.');
      expect(mine).not.toContain('INTERNAL-REASON-SECRET');
      expect(mine).not.toContain('REVIEWER-NOTE-SECRET');
      expect(mine).not.toContain(ops.userId);
      expect(mine).not.toContain(core.userId);

      const staff = await getApplication(kit.as(core), { applicationId });
      expect(staff.decisionReason).toBe('INTERNAL-REASON-SECRET');
      expect(staff.decidedBy?.userId).toBe(core.userId);
    });

    it('rejects: APPLICANT returns to MEMBER and the cooldown date is shared', async () => {
      const { core, applicant, applicationId } = await reviewed(kit);
      await decideApplication(kit.as(core), {
        applicationId,
        decision: 'reject',
        reason: 'Not enough verifiable output yet.',
      });
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['member']);
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'application.rejected'));
      expect(event!.payload).toMatchObject({ applicationId, grantedRole: null });
      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, applicant.userId));
      const decision = inbox.find((n) => n.title === 'APPLICATION NOT ACCEPTED')!;
      expect(decision.body).toContain('apply again from 2026-03-31');
      expect(decision.body).not.toContain('verifiable output');
    });

    it('grants the configured role, and never demotes', async () => {
      await setApplicationSettings(kit, { acceptedRole: 'verified' });
      const { core, applicant, applicationId } = await reviewed(kit);
      const result = await decideApplication(kit.as(core), {
        applicationId,
        decision: 'accept',
        reason: 'Exceptional record.',
      });
      expect(result.grantedRole).toBe('verified');
      expect((await resolveUserActor(kit.system, applicant.userId)).roles).toEqual(['verified']);
    });

    it('enforces the minimum number of counted reviews', async () => {
      await setApplicationSettings(kit, { minReviewsBeforeDecision: 2 });
      const { core, applicationId } = await reviewed(kit);
      const abstainer = await kit.member({ roles: ['operations'] });
      await reviewApplication(kit.as(abstainer), { applicationId, recommendation: 'abstain' });
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'Good.' }),
      ).rejects.toThrow(/needs 2 review/);
      await reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score: 4 });
      const result = await decideApplication(kit.as(core), {
        applicationId,
        decision: 'accept',
        reason: 'Good.',
      });
      expect(result.status).toBe('accepted');
    });

    it('allows a fast rejection from SUBMITTED only when no reviews are required', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicationId } = await submittedApplicant(kit);
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'reject', reason: 'Spam.' }),
      ).rejects.toThrow(/needs 1 review/);
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'Great.' }),
      ).rejects.toThrow(InvalidStateError);
      await setApplicationSettings(kit, { minReviewsBeforeDecision: 0 });
      const result = await decideApplication(kit.as(core), {
        applicationId,
        decision: 'reject',
        reason: 'Spam.',
      });
      expect(result.status).toBe('rejected');
    });

    it('cancels a pending interview reminder on decision', async () => {
      const { core, applicationId } = await reviewed(kit);
      await scheduleInterview(kit.as(core), {
        applicationId,
        interviewAt: new Date(kit.clock.now().getTime() + 48 * HOUR),
      });
      await decideApplication(kit.as(core), {
        applicationId,
        decision: 'accept',
        reason: 'Interview skipped; record speaks.',
      });
      const reminders = await kit.db
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      expect(reminders.map((r) => r.status)).toEqual(['cancelled']);
    });

    it('audits the decision with the internal reason (staff-only log)', async () => {
      const { core, applicationId } = await reviewed(kit);
      await decideApplication(kit.as(core), {
        applicationId,
        decision: 'accept',
        reason: 'Clear evidence.',
      });
      const [entry] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'application.decided'));
      expect(entry!.context).toMatchObject({ decision: 'accept', reason: 'Clear evidence.' });
    });

    it('refuses to decide twice', async () => {
      const { core, applicationId } = await reviewed(kit);
      await decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'Yes.' });
      await expect(
        decideApplication(kit.as(core), { applicationId, decision: 'reject', reason: 'No.' }),
      ).rejects.toThrow(InvalidStateError);
    });

    it('operations can review but not decide', async () => {
      const { ops, applicationId } = await reviewed(kit);
      await expect(
        decideApplication(kit.as(ops), { applicationId, decision: 'accept', reason: 'Yes.' }),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
