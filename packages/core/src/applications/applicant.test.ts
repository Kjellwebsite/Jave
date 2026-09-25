import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  applications,
  applicationStatusChanges,
  auditLogs,
  domainEvents,
  jobs,
  notifications,
  referralCodes,
} from '@jave/database';
import { resolveUserActor } from '../identity/users.service';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { DisabledError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
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
import { reviewApplication, startReview } from './review.service';
import {
  COMPLETE_DRAFT,
  createReferralCode,
  draftingApplicant,
  PGLITE_SUITE_TIMEOUTS,
  setApplicationSettings,
  submittedApplicant,
} from './test-fixtures';

vi.setConfig(PGLITE_SUITE_TIMEOUTS);

describe('applications: applicant self-service', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  describe('drafts', () => {
    it('creates one draft and returns it on repeat calls', async () => {
      const applicant = await kit.member();
      const first = await getOrCreateDraft(kit.as(applicant));
      const second = await getOrCreateDraft(kit.as(applicant));
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.application.id).toBe(first.application.id);
      expect(first.application.status).toBe('draft');
      expect(first.application.number).toMatch(/^APP-\d{4}$/);
      expect(first.application.readiness.ready).toBe(false);
      expect(first.application.draftExpiresAt?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
      const history = await kit.db
        .select()
        .from(applicationStatusChanges)
        .where(eq(applicationStatusChanges.applicationId, first.application.id));
      expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'draft']]);
    });

    it('patches only the fields given and clears blanks', async () => {
      const { applicant } = await draftingApplicant(kit);
      const view = await updateDraft(kit.as(applicant), { projects: '', motivation: undefined });
      expect(view.projects).toBeNull();
      expect(view.motivation).toBe(COMPLETE_DRAFT.motivation);
      expect(view.references).toBe(COMPLETE_DRAFT.references);
    });

    it('stamps edits with the injected clock', async () => {
      const { applicant, applicationId } = await draftingApplicant(kit);
      kit.clock.advance(DAY);
      await updateDraft(kit.as(applicant), { projects: 'Updated project list.' });
      const [row] = await kit.db
        .select({ updatedAt: applications.updatedAt })
        .from(applications)
        .where(eq(applications.id, applicationId));
      expect(row!.updatedAt.toISOString()).toBe('2026-03-02T12:00:00.000Z');
    });

    it('rejects unknown domains', async () => {
      const { applicant } = await draftingApplicant(kit);
      await expect(updateDraft(kit.as(applicant), { domainKey: 'astrology' })).rejects.toThrow(
        ValidationError,
      );
    });

    it('requires a draft to edit', async () => {
      const applicant = await kit.member();
      await expect(updateDraft(kit.as(applicant), { projects: 'x' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('does not start new drafts while applications are closed, but keeps existing ones', async () => {
      const { applicant } = await draftingApplicant(kit);
      await setApplicationSettings(kit, { open: false });
      const existing = await getOrCreateDraft(kit.as(applicant));
      expect(existing.created).toBe(false);
      const newcomer = await kit.member();
      await expect(getOrCreateDraft(kit.as(newcomer))).rejects.toThrow(DisabledError);
    });
  });

  describe('referral codes', () => {
    it('stores the canonical code for an active code, matched case-insensitively', async () => {
      const referrer = await kit.member();
      await createReferralCode(kit, referrer, 'BUILD2026');
      const { applicant } = await draftingApplicant(kit);
      const view = await updateDraft(kit.as(applicant), { referralCode: 'build2026' });
      expect(view.referralCode).toBe('BUILD2026');
    });

    it('rejects unknown and inactive codes', async () => {
      const referrer = await kit.member();
      await createReferralCode(kit, referrer, 'OLD', false);
      const { applicant } = await draftingApplicant(kit);
      await expect(updateDraft(kit.as(applicant), { referralCode: 'NOPE' })).rejects.toThrow(
        /not found/,
      );
      await expect(updateDraft(kit.as(applicant), { referralCode: 'OLD' })).rejects.toThrow(
        /not found/,
      );
    });

    it('re-checks the code at submission', async () => {
      const referrer = await kit.member();
      await createReferralCode(kit, referrer, 'LIVE');
      const { applicant } = await draftingApplicant(kit, {
        ...COMPLETE_DRAFT,
        referralCode: 'LIVE',
      });
      await kit.db.update(referralCodes).set({ active: false });
      await expect(submitApplication(kit.as(applicant))).rejects.toThrow(/no longer active/);
    });
  });

  describe('submission', () => {
    it('submits, grants APPLICANT, notifies and queues the review card', async () => {
      const reviewer = await kit.member({ roles: ['operations'] });
      const { applicant, applicationId } = await draftingApplicant(kit);
      const view = await submitApplication(kit.as(applicant));

      expect(view.status).toBe('submitted');
      expect(view.submittedAt?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
      expect(view.draftExpiresAt).toBeNull();
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['applicant']);

      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.aggregateId, applicationId));
      const submitted = events.find((e) => e.type === 'application.submitted')!;
      expect(submitted.subjectMemberId).toBe(applicant.memberId);
      expect(submitted.payload).not.toHaveProperty('motivation');
      expect(events.map((e) => e.type)).toContain('application.status_changed');

      const reviewerInbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, reviewer.userId));
      expect(reviewerInbox.map((n) => n.type)).toEqual(['application.received']);
      expect(reviewerInbox[0]!.title).toBe('APPLICATION RECEIVED');
      expect(reviewerInbox[0]!.body).toContain('CREATE');

      const applicantInbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, applicant.userId));
      expect(applicantInbox.map((n) => n.title)).toEqual(['APPLICATION SUBMITTED']);

      const cardJobs = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_REVIEW_CARD_JOB));
      expect(cardJobs).toHaveLength(1);
      expect(cardJobs[0]!.payload).toEqual({ applicationId, revision: 1 });

      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'application.submitted'));
      expect(audit).toHaveLength(1);
    });

    it('lists every missing requirement', async () => {
      const applicant = await kit.member();
      await getOrCreateDraft(kit.as(applicant));
      await updateDraft(kit.as(applicant), { motivation: 'too short' });
      const error = await submitApplication(kit.as(applicant)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((i) => i.path)).toEqual([
        'domain',
        'motivation',
        'experience',
        'proof_of_work',
      ]);
    });

    it('is refused while applications are closed', async () => {
      const { applicant } = await draftingApplicant(kit);
      await setApplicationSettings(kit, { open: false });
      await expect(submitApplication(kit.as(applicant))).rejects.toThrow(DisabledError);
    });

    it('freezes the application once submitted', async () => {
      const { applicant } = await submittedApplicant(kit);
      await expect(updateDraft(kit.as(applicant), { projects: 'changed' })).rejects.toThrow(
        InvalidStateError,
      );
      await expect(submitApplication(kit.as(applicant))).rejects.toThrow(InvalidStateError);
    });

    it('enforces the rejection cooldown from the decision time', async () => {
      const decider = await kit.member({ roles: ['core'] });
      const reviewer = await kit.member({ roles: ['operations'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await reviewApplication(kit.as(reviewer), {
        applicationId,
        recommendation: 'reject',
        score: 2,
      });
      await decideApplication(kit.as(decider), {
        applicationId,
        decision: 'reject',
        reason: 'No evidence of shipped work.',
      });
      const again = await resolveUserActor(kit.system, applicant.userId);
      expect(again.roles).toEqual(['member']);

      await getOrCreateDraft(kit.as(again));
      await updateDraft(kit.as(again), COMPLETE_DRAFT);
      kit.clock.advance(29 * DAY);
      await expect(submitApplication(kit.as(again))).rejects.toThrow(/apply again from 2026-03-31/);
      const status = await getMyApplication(kit.as(again));
      expect(status.cooldownEndsAt?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
      kit.clock.advance(DAY);
      const view = await submitApplication(kit.as(again));
      expect(view.status).toBe('submitted');
    });
  });

  describe('withdrawal', () => {
    it('withdraws a submitted application and returns APPLICANT to MEMBER', async () => {
      const { applicant, applicationId } = await submittedApplicant(kit);
      const view = await withdrawApplication(kit.as(applicant), { reason: 'Timing is wrong.' });
      expect(view.status).toBe('withdrawn');
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['member']);
      const [change] = await kit.db
        .select()
        .from(applicationStatusChanges)
        .where(
          and(
            eq(applicationStatusChanges.applicationId, applicationId),
            eq(applicationStatusChanges.toStatus, 'withdrawn'),
          ),
        );
      expect(change!.note).toBe('Timing is wrong.');
      const events = await kit.db
        .select({ type: domainEvents.type })
        .from(domainEvents)
        .where(eq(domainEvents.type, 'application.withdrawn'));
      expect(events).toHaveLength(1);
      // The staff card reflects the withdrawal.
      const cardJobs = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_REVIEW_CARD_JOB));
      expect(cardJobs.map((j) => j.payload.revision)).toEqual([1, 2]);
    });

    it('discards a draft without touching roles or the review channel', async () => {
      const { applicant } = await draftingApplicant(kit);
      await withdrawApplication(kit.as(applicant));
      const cardJobs = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_REVIEW_CARD_JOB));
      expect(cardJobs).toHaveLength(0);
      const actor = await resolveUserActor(kit.system, applicant.userId);
      expect(actor.roles).toEqual(['member']);
      const next = await getOrCreateDraft(kit.as(applicant));
      expect(next.created).toBe(true);
    });

    it('needs an open application', async () => {
      const applicant = await kit.member();
      await expect(withdrawApplication(kit.as(applicant))).rejects.toThrow(NotFoundError);
    });

    /** Withdraw, then prepare a complete new draft; returns the refreshed actor. */
    async function withdrawAndRedraft(applicant: UserActor): Promise<UserActor> {
      await withdrawApplication(kit.as(applicant));
      const again = await resolveUserActor(kit.system, applicant.userId);
      await getOrCreateDraft(kit.as(again));
      await updateDraft(kit.as(again), COMPLETE_DRAFT);
      return again;
    }

    it('a withdrawal after submission blocks a new submission for withdrawalCooldownHours', async () => {
      await setApplicationSettings(kit, { withdrawalCooldownHours: 6 });
      const { applicant } = await submittedApplicant(kit);
      const before = await getMyApplication(kit.as(applicant));
      expect(before.withdrawalCooldownEndsAt?.toISOString()).toBe('2026-03-01T18:00:00.000Z');

      const again = await withdrawAndRedraft(applicant);
      const status = await getMyApplication(kit.as(again));
      expect(status.cooldownEndsAt?.toISOString()).toBe('2026-03-01T18:00:00.000Z');
      // Withdrawing the new draft would add nothing.
      expect(status.withdrawalCooldownEndsAt?.toISOString()).toBe('2026-03-01T18:00:00.000Z');
      kit.clock.advance(6 * HOUR - MINUTE);
      await expect(submitApplication(kit.as(again))).rejects.toThrow(
        /apply again from 2026-03-01 18:00 UTC/,
      );
      kit.clock.advance(MINUTE);
      expect((await submitApplication(kit.as(again))).status).toBe('submitted');
    });

    it('BREAK: withdrawing once review started cannot dodge the rejection cooldown', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(ops), { applicationId });
      // The applicant can see the consequence before confirming.
      const preview = await getMyApplication(kit.as(applicant));
      expect(preview.withdrawalCooldownEndsAt?.toISOString()).toBe('2026-03-31T12:00:00.000Z');

      const again = await withdrawAndRedraft(applicant);
      kit.clock.advance(30 * DAY - MINUTE);
      await expect(submitApplication(kit.as(again))).rejects.toThrow(
        /apply again from 2026-03-31 12:00 UTC/,
      );
      kit.clock.advance(MINUTE);
      expect((await submitApplication(kit.as(again))).status).toBe('submitted');
    });

    it('discarding a draft starts no cooldown', async () => {
      const { applicant } = await draftingApplicant(kit);
      expect((await getMyApplication(kit.as(applicant))).withdrawalCooldownEndsAt).toBeNull();
      const again = await withdrawAndRedraft(applicant);
      expect((await getMyApplication(kit.as(again))).cooldownEndsAt).toBeNull();
      expect((await submitApplication(kit.as(again))).status).toBe('submitted');
    });
  });

  describe('my application', () => {
    it('reports eligibility and the latest application', async () => {
      const newcomer = await kit.member();
      expect(await getMyApplication(kit.as(newcomer))).toEqual({
        application: null,
        applicationsOpen: true,
        eligible: true,
        cooldownEndsAt: null,
        withdrawalCooldownEndsAt: null,
      });
      const trial = await kit.member({ roles: ['trial'] });
      expect((await getMyApplication(kit.as(trial))).eligible).toBe(false);
    });

    it('shows the applicant their own answers and a status timeline', async () => {
      const { applicant } = await submittedApplicant(kit);
      const status = await getMyApplication(kit.as(applicant));
      expect(status.application?.references).toBe(COMPLETE_DRAFT.references);
      expect(status.application?.timeline.map((t) => t.status)).toEqual(['draft', 'submitted']);
    });
  });
});
