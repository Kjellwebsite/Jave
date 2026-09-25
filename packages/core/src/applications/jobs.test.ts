import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  applications,
  applicationStatusChanges,
  domainEvents,
  jobs,
  members,
  notificationDeliveries,
  notifications,
} from '@jave/database';
import { enqueueJob, enqueueRecurring } from '../jobs/queue';
import { PermanentJobError } from '../jobs/worker';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { updateSettings } from '../settings/settings.service';
import { coreJobHandlers, coreRecurringJobs } from '../registry';
import { createTestKit, type TestKit } from '../testing';
import { updateDraft } from './applicant.service';
import { APPLICATION_REVIEW_CARD_JOB } from './discord-jobs';
import { recurringJobs } from './index';
import {
  APPLICATION_DRAFT_EXPIRY_JOB,
  APPLICATION_INTERVIEW_REMINDER_JOB,
  APPLICATION_REVIEW_REMINDER_JOB,
} from './keys';
import { reviewApplication, scheduleInterview, startReview } from './review.service';
import {
  applicationHandlers,
  draftingApplicant,
  PGLITE_SUITE_TIMEOUTS,
  submittedApplicant,
} from './test-fixtures';

vi.setConfig(PGLITE_SUITE_TIMEOUTS);

async function titlesFor(kit: TestKit, userId: string): Promise<string[]> {
  const rows = await kit.db
    .select({ title: notifications.title })
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId));
  return rows.map((row) => row.title);
}

describe('applications: background jobs', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('is wired into the core registry', () => {
    const handlers = coreJobHandlers();
    for (const type of [
      APPLICATION_DRAFT_EXPIRY_JOB,
      APPLICATION_REVIEW_REMINDER_JOB,
      APPLICATION_INTERVIEW_REMINDER_JOB,
    ]) {
      expect(handlers[type]).toBeTypeOf('function');
    }
    expect(handlers[APPLICATION_REVIEW_CARD_JOB]).toBeUndefined();
    expect(coreRecurringJobs).toEqual(expect.arrayContaining([...recurringJobs]));
  });

  describe('draft expiry', () => {
    it('withdraws drafts untouched for 30 days, once', async () => {
      const stale = await draftingApplicant(kit);
      kit.clock.advance(20 * DAY);
      const edited = await draftingApplicant(kit);
      const submitted = await submittedApplicant(kit);

      kit.clock.advance(10 * DAY - MINUTE);
      await enqueueRecurring(kit.system, APPLICATION_DRAFT_EXPIRY_JOB, HOUR);
      await kit.drain(applicationHandlers());
      const [early] = await kit.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, stale.applicationId));
      expect(early!.status).toBe('draft');

      kit.clock.advance(2 * MINUTE);
      await enqueueRecurring(kit.system, APPLICATION_DRAFT_EXPIRY_JOB, HOUR);
      // Same time bucket: the recurring job is not scheduled twice.
      expect(await enqueueRecurring(kit.system, APPLICATION_DRAFT_EXPIRY_JOB, HOUR)).toBeNull();
      await kit.drain(applicationHandlers());

      const rows = await kit.db
        .select({ id: applications.id, status: applications.status })
        .from(applications);
      const statusOf = (id: string) => rows.find((row) => row.id === id)!.status;
      expect(statusOf(stale.applicationId)).toBe('withdrawn');
      expect(statusOf(edited.applicationId)).toBe('draft');
      expect(statusOf(submitted.applicationId)).toBe('submitted');

      const [change] = await kit.db
        .select()
        .from(applicationStatusChanges)
        .where(eq(applicationStatusChanges.toStatus, 'withdrawn'));
      expect(change!.note).toBe('expired: no edits for 30 days');
      expect(change!.actorUserId).toBeNull();
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'application.withdrawn'));
      expect(event!.payload).toMatchObject({ by: 'expiry' });
      expect(await titlesFor(kit, stale.applicant.userId)).toEqual(['DRAFT CLOSED']);

      kit.clock.advance(HOUR);
      await enqueueRecurring(kit.system, APPLICATION_DRAFT_EXPIRY_JOB, HOUR);
      await kit.drain(applicationHandlers());
      expect(await titlesFor(kit, stale.applicant.userId)).toEqual(['DRAFT CLOSED']);
    });

    it('counts an edit as activity and honours the configured expiry', async () => {
      await updateSettings(kit.system, 'applications', { draftExpiryDays: 7 });
      const { applicant, applicationId } = await draftingApplicant(kit);
      kit.clock.advance(6 * DAY);
      await updateDraft(kit.as(applicant), { projects: 'Another shipped project.' });
      kit.clock.advance(6 * DAY);
      await enqueueJob(kit.system, APPLICATION_DRAFT_EXPIRY_JOB);
      await kit.drain(applicationHandlers());
      const [row] = await kit.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, applicationId));
      expect(row!.status).toBe('draft');
    });
  });

  describe('review reminders', () => {
    it('reminds reviewers once about submissions waiting past 72h', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const waiting = await submittedApplicant(kit);
      const claimed = await submittedApplicant(kit);
      await startReview(kit.as(ops), { applicationId: claimed.applicationId });

      kit.clock.advance(71 * HOUR);
      await enqueueJob(kit.system, APPLICATION_REVIEW_REMINDER_JOB);
      await kit.drain(applicationHandlers());
      expect(await titlesFor(kit, ops.userId)).not.toContain('APPLICATION WAITING');

      kit.clock.advance(2 * HOUR);
      await enqueueJob(kit.system, APPLICATION_REVIEW_REMINDER_JOB);
      await kit.drain(applicationHandlers());
      await enqueueJob(kit.system, APPLICATION_REVIEW_REMINDER_JOB);
      await kit.drain(applicationHandlers());

      const reminders = (await titlesFor(kit, ops.userId)).filter(
        (title) => title === 'APPLICATION WAITING',
      );
      expect(reminders).toHaveLength(1);
      const [row] = await kit.db
        .select()
        .from(applications)
        .where(eq(applications.id, waiting.applicationId));
      expect(row!.reviewReminderSentAt?.toISOString()).toBe('2026-03-04T13:00:00.000Z');
      // Bookkeeping is not an edit.
      expect(row!.updatedAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
      expect(await titlesFor(kit, waiting.applicant.userId)).not.toContain('APPLICATION WAITING');
    });

    /** Run one reminder sweep. */
    async function sweepReminders(): Promise<void> {
      await enqueueJob(kit.system, APPLICATION_REVIEW_REMINDER_JOB);
      await kit.drain(applicationHandlers());
    }

    /** Application ids `userId` was notified about under `title`. */
    async function remindedAbout(userId: string, title: string): Promise<string[]> {
      const rows = await kit.db
        .select({ data: notifications.data })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), eq(notifications.title, title)));
      return rows.map((row) => String(row.data.applicationId)).sort();
    }

    it('reminds the assigned reviewer once when a claimed review stalls', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const stalled = await submittedApplicant(kit);
      const abstained = await submittedApplicant(kit);
      const reviewed = await submittedApplicant(kit);
      for (const { applicationId } of [stalled, abstained, reviewed]) {
        await startReview(kit.as(ops), { applicationId });
      }
      await reviewApplication(kit.as(ops), {
        applicationId: abstained.applicationId,
        recommendation: 'abstain',
      });
      await reviewApplication(kit.as(ops), {
        applicationId: reviewed.applicationId,
        recommendation: 'accept',
        score: 4,
      });

      kit.clock.advance(72 * HOUR - MINUTE);
      await sweepReminders();
      expect(await remindedAbout(ops.userId, 'REVIEW PENDING')).toEqual([]);

      kit.clock.advance(2 * MINUTE);
      await sweepReminders();
      await sweepReminders();
      // An abstention is not a recommendation; a counted review ends the wait.
      expect(await remindedAbout(ops.userId, 'REVIEW PENDING')).toEqual(
        [stalled.applicationId, abstained.applicationId].sort(),
      );
      expect(await titlesFor(kit, stalled.applicant.userId)).not.toContain('REVIEW PENDING');
    });

    it('gives every reassignment its own reminder window', async () => {
      const core = await kit.member({ roles: ['core'] });
      const first = await kit.member({ roles: ['operations'] });
      const second = await kit.member({ roles: ['operations'] });
      const { applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId, reviewerUserId: first.userId });

      kit.clock.advance(73 * HOUR);
      await sweepReminders();
      expect(await remindedAbout(first.userId, 'REVIEW PENDING')).toEqual([applicationId]);

      await startReview(kit.as(core), { applicationId, reviewerUserId: second.userId });
      kit.clock.advance(71 * HOUR);
      await sweepReminders();
      expect(await remindedAbout(second.userId, 'REVIEW PENDING')).toEqual([]);
      kit.clock.advance(2 * HOUR);
      await sweepReminders();
      await sweepReminders();
      expect(await remindedAbout(second.userId, 'REVIEW PENDING')).toEqual([applicationId]);
      expect(await remindedAbout(first.userId, 'REVIEW PENDING')).toEqual([applicationId]);
    });

    it('asks deciders to reassign when the assigned reviewer can no longer review', async () => {
      const core = await kit.member({ roles: ['core'] });
      const ops = await kit.member({ roles: ['operations'] });
      const { applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(ops), { applicationId });
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, ops.memberId!));

      kit.clock.advance(73 * HOUR);
      await sweepReminders();
      expect(await remindedAbout(core.userId, 'REVIEW STALLED')).toEqual([applicationId]);
      expect(await titlesFor(kit, ops.userId)).not.toContain('REVIEW PENDING');
    });
  });

  describe('interview reminder', () => {
    it('reminds the applicant an hour before, and skips a moved interview', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      const at = new Date(kit.clock.now().getTime() + 48 * HOUR);
      await scheduleInterview(kit.as(core), { applicationId, interviewAt: at });

      kit.clock.advance(47 * HOUR - MINUTE);
      await kit.drain(applicationHandlers());
      expect(await titlesFor(kit, applicant.userId)).not.toContain('INTERVIEW IN 1 HOUR');
      kit.clock.advance(MINUTE);
      await kit.drain(applicationHandlers());
      expect(await titlesFor(kit, applicant.userId)).toContain('INTERVIEW IN 1 HOUR');

      const handler = applicationHandlers()[APPLICATION_INTERVIEW_REMINDER_JOB]!;
      const [job] = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, APPLICATION_INTERVIEW_REMINDER_JOB));
      const stale = await handler(
        kit.system,
        { applicationId, interviewAt: new Date(at.getTime() + HOUR).toISOString() },
        job!,
      );
      expect(stale).toEqual({ skipped: 'interview moved or closed' });
      await expect(handler(kit.system, { applicationId: 'nope' }, job!)).rejects.toThrow(
        PermanentJobError,
      );
    });

    it('BREAK: a failure part way through leaves nothing behind, so the retry sends it in full', async () => {
      const core = await kit.member({ roles: ['core'] });
      const { applicant, applicationId } = await submittedApplicant(kit);
      await startReview(kit.as(core), { applicationId });
      await scheduleInterview(kit.as(core), {
        applicationId,
        interviewAt: new Date(kit.clock.now().getTime() + 48 * HOUR),
      });
      // Fault injection in real SQL: the DM delivery row fails after the inbox row is written.
      await kit.database.exec(`
        create function test_fail_delivery() returns trigger language plpgsql
          as $$ begin raise exception 'injected delivery failure'; end $$;
        create trigger test_fail_delivery before insert on notification_deliveries
          for each row execute function test_fail_delivery();
      `);

      kit.clock.advance(47 * HOUR);
      const failed = await kit.drain(applicationHandlers());
      const attempt = failed.find((o) => o.type === APPLICATION_INTERVIEW_REMINDER_JOB);
      expect(attempt).toMatchObject({ status: 'retry' });
      expect(attempt?.error).toMatch(/insert into "notification_deliveries"/);
      expect(await titlesFor(kit, applicant.userId)).not.toContain('INTERVIEW IN 1 HOUR');

      await kit.database.exec('drop trigger test_fail_delivery on notification_deliveries;');
      kit.clock.advance(MINUTE);
      const retried = await kit.drain(applicationHandlers());
      expect(retried.find((o) => o.type === APPLICATION_INTERVIEW_REMINDER_JOB)).toMatchObject({
        status: 'completed',
        result: { reminded: true },
      });
      const [reminder] = await kit.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, applicant.userId),
            eq(notifications.title, 'INTERVIEW IN 1 HOUR'),
          ),
        );
      const deliveries = await kit.db
        .select({ channel: notificationDeliveries.channel })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, reminder!.id));
      expect(deliveries).toEqual([{ channel: 'discord_dm' }]);
    });
  });
});
