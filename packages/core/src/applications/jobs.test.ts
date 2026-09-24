import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  applications,
  applicationStatusChanges,
  domainEvents,
  jobs,
  notifications,
} from '@jave/database';
import { enqueueJob, enqueueRecurring } from '../jobs/queue';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import { coreJobHandlers, coreRecurringJobs } from '../registry';
import { createTestKit, type TestKit } from '../testing';
import { updateDraft, withdrawApplication } from './applicant.service';
import { decideApplication } from './decision.service';
import {
  APPLICATION_REVIEW_CARD_JOB,
  type ReviewCardJobPayload,
  reviewCardJobPayloadSchema,
} from './discord-jobs';
import { recurringJobs } from './index';
import {
  APPLICATION_DRAFT_EXPIRY_JOB,
  APPLICATION_INTERVIEW_REMINDER_JOB,
  APPLICATION_REVIEW_REMINDER_JOB,
} from './keys';
import { getReviewCard, recordReviewCardMessage } from './review-card.service';
import { reviewApplication, scheduleInterview, startReview } from './review.service';
import {
  applicationHandlers,
  COMPLETE_DRAFT,
  draftingApplicant,
  submittedApplicant,
} from './test-fixtures';

const REVIEW_CHANNEL = '400000000000000001';

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
  });
});

/**
 * MOCK / DEVELOPMENT ONLY — a stand-in for the bot's review-card handler,
 * written against the contract in discord-jobs.ts, to prove the contract is
 * implementable and convergent. Records "posted" and "deleted" messages.
 */
function simulatedBot() {
  let nextMessage = 500000000000000000n;
  const posted: { channelId: string; messageId: string; revision: number }[] = [];
  const edited: { messageId: string; revision: number }[] = [];
  const deleted: string[] = [];
  const handler: JobHandler = async (ctx, payload) => {
    const job: ReviewCardJobPayload = reviewCardJobPayloadSchema.parse(payload);
    const card = await getReviewCard(ctx, { applicationId: job.applicationId });
    if (card.revision > job.revision) return { skipped: 'superseded' };
    let message = card.message;
    if (message) {
      edited.push({ messageId: message.messageId, revision: card.revision });
    } else {
      if (!card.channelId) return { skipped: 'no review channel' };
      nextMessage += 1n;
      message = { channelId: card.channelId, messageId: nextMessage.toString() };
      posted.push({ ...message, revision: card.revision });
    }
    const { discard } = await recordReviewCardMessage(ctx, {
      applicationId: job.applicationId,
      channelId: message.channelId,
      messageId: message.messageId,
      revision: card.revision,
    });
    if (discard) deleted.push(discard.messageId);
    return { rendered: card.revision };
  };
  return { handler, posted, edited, deleted };
}

describe('applications: review card contract', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
    await updateSettings(kit.system, 'channels', { applicationsReview: REVIEW_CHANNEL });
  });
  afterEach(async () => {
    await kit.close();
  });

  it('exposes card data without references or decision reasons', async () => {
    const core = await kit.member({ roles: ['core'] });
    const { applicationId } = await submittedApplicant(kit);
    await reviewApplication(kit.as(core), { applicationId, recommendation: 'accept', score: 5 });
    await decideApplication(kit.as(core), {
      applicationId,
      decision: 'accept',
      reason: 'INTERNAL-ONLY-REASON',
    });
    const card = await getReviewCard(kit.system, { applicationId });
    expect(card).toMatchObject({
      status: 'accepted',
      channelId: REVIEW_CHANNEL,
      message: null,
      domain: { key: 'create', label: 'Create' },
      decisionReady: true,
      evidenceLinkCount: 1,
      referred: false,
      actions: [],
    });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain(COMPLETE_DRAFT.references);
    expect(serialized).not.toContain('INTERNAL-ONLY-REASON');
  });

  it('converges on one card that shows the newest revision', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const { applicant, applicationId } = await submittedApplicant(kit);
    await startReview(kit.as(ops), { applicationId });
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 4 });

    const bot = simulatedBot();
    const handlers = { ...applicationHandlers(), [APPLICATION_REVIEW_CARD_JOB]: bot.handler };
    const outcomes = await kit.drain(handlers);
    const cardRuns = outcomes.filter((o) => o.type === APPLICATION_REVIEW_CARD_JOB);
    expect(cardRuns.filter((o) => o.result?.skipped === 'superseded')).toHaveLength(
      cardRuns.length - 1,
    );
    expect(bot.posted).toHaveLength(1);

    await withdrawApplication(kit.as(applicant));
    await kit.drain(handlers);
    expect(bot.posted).toHaveLength(1);
    expect(bot.edited).toHaveLength(1);
    const [row] = await kit.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    expect(row!.reviewMessageId).toBe(bot.posted[0]!.messageId);
    expect(row!.reviewCardRenderedRevision).toBe(row!.reviewCardRevision);
  });

  it('keeps the newest render when two renders race, and returns the loser to delete', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const { applicationId } = await submittedApplicant(kit);
    await startReview(kit.as(ops), { applicationId });
    const record = (messageId: string, revision: number) =>
      recordReviewCardMessage(kit.system, {
        applicationId,
        channelId: REVIEW_CHANNEL,
        messageId,
        revision,
      });
    expect(await record('600000000000000001', 2)).toEqual({ discard: null });
    expect(await record('600000000000000001', 2)).toEqual({ discard: null });
    // An older render that posted a second message loses.
    expect(await record('600000000000000002', 1)).toEqual({
      discard: { channelId: REVIEW_CHANNEL, messageId: '600000000000000002' },
    });
    // A newer render that posted a second message wins; the stored one is discarded.
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'abstain' });
    expect(await record('600000000000000003', 3)).toEqual({
      discard: { channelId: REVIEW_CHANNEL, messageId: '600000000000000001' },
    });
    await expect(record('600000000000000004', 99)).rejects.toThrow(ValidationError);
  });

  it('only the worker records card messages', async () => {
    const core = await kit.member({ roles: ['core'] });
    const { applicationId } = await submittedApplicant(kit);
    await expect(
      recordReviewCardMessage(kit.as(core), {
        applicationId,
        channelId: REVIEW_CHANNEL,
        messageId: '600000000000000001',
        revision: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('skips cleanly when no review channel is configured', async () => {
    await updateSettings(kit.system, 'channels', { applicationsReview: undefined });
    await submittedApplicant(kit);
    const bot = simulatedBot();
    const outcomes = await kit.drain({
      ...applicationHandlers(),
      [APPLICATION_REVIEW_CARD_JOB]: bot.handler,
    });
    const card = outcomes.find((o) => o.type === APPLICATION_REVIEW_CARD_JOB);
    expect(card?.result).toEqual({ skipped: 'no review channel' });
  });
});
