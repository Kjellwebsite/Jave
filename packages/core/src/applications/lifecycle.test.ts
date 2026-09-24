import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { applicationStatusChanges, jobs, notifications } from '@jave/database';
import { resolveUserActor } from '../identity/users.service';
import { HOUR } from '../kernel/clock';
import { coreJobHandlers } from '../registry';
import { createTestKit, type TestKit } from '../testing';
import {
  getMyApplication,
  getOrCreateDraft,
  submitApplication,
  updateDraft,
} from './applicant.service';
import { decideApplication } from './decision.service';
import { APPLICATION_REVIEW_CARD_JOB } from './discord-jobs';
import { reviewApplication, scheduleInterview, startReview } from './review.service';
import { getApplication } from './staff-queries.service';
import { COMPLETE_DRAFT, PGLITE_SUITE_TIMEOUTS } from './test-fixtures';

vi.setConfig(PGLITE_SUITE_TIMEOUTS);

describe('applications: end-to-end lifecycle', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('DRAFT → SUBMITTED → REVIEW → INTERVIEW → ACCEPTED with every side effect committed', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    const applicant = await kit.member();

    await getOrCreateDraft(kit.as(applicant));
    await updateDraft(kit.as(applicant), COMPLETE_DRAFT);
    await submitApplication(kit.as(applicant));
    const { application } = await getMyApplication(kit.as(applicant));
    const applicationId = application!.id;

    await startReview(kit.as(ops), { applicationId });
    await reviewApplication(kit.as(ops), {
      applicationId,
      recommendation: 'interview',
      score: 4,
      note: 'Ask about team leadership.',
    });
    await scheduleInterview(kit.as(core), {
      applicationId,
      interviewAt: new Date(kit.clock.now().getTime() + 24 * HOUR),
    });
    // The worker runs as time passes: the interview reminder fires on schedule.
    kit.clock.advance(25 * HOUR);
    await kit.drain(coreJobHandlers());
    await reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score: 5 });
    const decision = await decideApplication(kit.as(core), {
      applicationId,
      decision: 'accept',
      reason: 'Interview confirmed depth.',
      applicantMessage: 'Welcome to JAVELIN. Prove it.',
    });
    expect(decision).toMatchObject({ status: 'accepted', grantedRole: 'trial' });

    // Every core-owned job (events, notifications, reminders) runs clean.
    await kit.drain(coreJobHandlers());
    const unfinished = await kit.db
      .select({ type: jobs.type, status: jobs.status, lastError: jobs.lastError })
      .from(jobs)
      .where(ne(jobs.status, 'completed'));
    const nonDiscord = unfinished.filter(
      (job) => !job.type.startsWith('discord.') && job.type !== 'notifications.deliver',
    );
    expect(nonDiscord).toEqual([]);
    // Discord side effects wait for the bot.
    expect(unfinished.map((job) => job.type)).toEqual(
      expect.arrayContaining([APPLICATION_REVIEW_CARD_JOB, 'discord.roles.sync']),
    );

    const history = await kit.db
      .select({ from: applicationStatusChanges.fromStatus, to: applicationStatusChanges.toStatus })
      .from(applicationStatusChanges)
      .where(eq(applicationStatusChanges.applicationId, applicationId));
    expect(history).toHaveLength(5);
    const staff = await getApplication(kit.as(core), { applicationId });
    expect(staff.history.map((h) => `${h.from ?? '∅'}→${h.to}`)).toEqual([
      '∅→draft',
      'draft→submitted',
      'submitted→review',
      'review→interview',
      'interview→accepted',
    ]);
    expect(staff.tally).toMatchObject({ counted: 2, interview: 1, accept: 1, averageScore: 4.5 });

    const inbox = await kit.db
      .select({ title: notifications.title })
      .from(notifications)
      .where(eq(notifications.recipientUserId, applicant.userId));
    expect(inbox.map((n) => n.title).sort()).toEqual(
      [
        'APPLICATION SUBMITTED',
        'APPLICATION IN REVIEW',
        'INTERVIEW SCHEDULED',
        'INTERVIEW IN 1 HOUR',
        'APPLICATION ACCEPTED',
      ].sort(),
    );

    const actor = await resolveUserActor(kit.system, applicant.userId);
    expect(actor.roles).toEqual(['trial']);
    const mine = await getMyApplication(kit.as(actor));
    expect(mine.application).toMatchObject({
      status: 'accepted',
      applicantMessage: 'Welcome to JAVELIN. Prove it.',
    });
    expect(mine.eligible).toBe(false);
  });
});
