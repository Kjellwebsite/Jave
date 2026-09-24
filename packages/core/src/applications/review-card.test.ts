import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { applications, jobs } from '@jave/database';
import type { JobHandler } from '../jobs/worker';
import { MINUTE } from '../kernel/clock';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, ForbiddenError, ValidationError } from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import { createTestKit, type TestKit } from '../testing';
import { withdrawApplication } from './applicant.service';
import { decideApplication } from './decision.service';
import { APPLICATION_REVIEW_CARD_JOB, reviewCardJobPayloadSchema } from './discord-jobs';
import {
  beginReviewCardRender,
  getReviewCard,
  type MessageRef,
  recordReviewCardMessage,
  releaseReviewCardRender,
  REVIEW_CARD_RENDER_LEASE_MS,
  type ReviewCard,
} from './review-card.service';
import { reviewApplication, startReview } from './review.service';
import type { ApplicationStatus, StaffAction } from './state-machine';
import {
  applicationHandlers,
  COMPLETE_DRAFT,
  PGLITE_SUITE_TIMEOUTS,
  setApplicationSettings,
  submittedApplicant,
} from './test-fixtures';

vi.setConfig(PGLITE_SUITE_TIMEOUTS);

const REVIEW_CHANNEL = '400000000000000001';
/** Longer than the queue's first retry backoff (10 s). */
const PAST_FIRST_BACKOFF_MS = MINUTE;

interface ShownCard {
  messageId: string;
  revision: number;
  status: ApplicationStatus;
  actions: readonly StaffAction[];
}

/**
 * MOCK / DEVELOPMENT ONLY — a stand-in for the bot's review-card handler,
 * written against the contract in discord-jobs.ts, to prove the contract is
 * implementable and convergent. `shown` lists every post or edit in the
 * order "Discord" applied it; `show` lets a test apply a render's edit at a
 * moment of its choosing.
 */
function simulatedBot() {
  let nextMessage = 500000000000000000n;
  const posted: MessageRef[] = [];
  const shown: ShownCard[] = [];
  const deleted: string[] = [];

  function show(card: ReviewCard): MessageRef | null {
    let message = card.message;
    if (!message) {
      if (!card.channelId) return null;
      nextMessage += 1n;
      message = { channelId: card.channelId, messageId: nextMessage.toString() };
      posted.push(message);
    }
    shown.push({
      messageId: message.messageId,
      revision: card.revision,
      status: card.status,
      actions: card.actions,
    });
    return message;
  }

  async function finish(
    ctx: ServiceContext,
    card: ReviewCard,
    message: MessageRef,
    renderId: string,
  ): Promise<void> {
    const { discard } = await recordReviewCardMessage(ctx, {
      applicationId: card.applicationId,
      ...message,
      revision: card.revision,
      renderId,
    });
    if (discard) deleted.push(discard.messageId);
  }

  const handler: JobHandler = async (ctx, payload, job) => {
    const { applicationId, revision } = reviewCardJobPayloadSchema.parse(payload);
    const renderId = String(job.id);
    const start = await beginReviewCardRender(ctx, { applicationId, revision, renderId });
    if (start.outcome === 'superseded') return { skipped: 'superseded' };
    if (start.outcome === 'no_channel') return { skipped: 'no review channel' };
    try {
      const message = show(start.card);
      if (!message) {
        await releaseReviewCardRender(ctx, { applicationId, renderId });
        return { skipped: 'no review channel' };
      }
      await finish(ctx, start.card, message, renderId);
      return { rendered: start.card.revision };
    } catch (error) {
      await releaseReviewCardRender(ctx, { applicationId, renderId }).catch(() => undefined);
      throw error;
    }
  };

  return { handler, show, finish, posted, shown, deleted };
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

  function withBot(bot: ReturnType<typeof simulatedBot>) {
    return { ...applicationHandlers(), [APPLICATION_REVIEW_CARD_JOB]: bot.handler };
  }

  async function cardRow(applicationId: string) {
    const [row] = await kit.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    return row!;
  }

  /** A submitted application in REVIEW whose card is posted and up to date. */
  async function cardInReview(bot: ReturnType<typeof simulatedBot>) {
    const ops = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });
    const { applicant, applicationId } = await submittedApplicant(kit);
    await startReview(kit.as(ops), { applicationId });
    await kit.drain(withBot(bot));
    expect(bot.posted).toHaveLength(1);
    return { ops, core, applicant, applicationId };
  }

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

  it('offers accept and reject only once a decision can succeed', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const { applicationId } = await submittedApplicant(kit);
    const actions = async (id: string) =>
      (await getReviewCard(kit.system, { applicationId: id })).actions;

    // Default minReviewsBeforeDecision is 1, and no review exists yet.
    expect(await actions(applicationId)).toEqual(['start_review', 'review']);
    await startReview(kit.as(ops), { applicationId });
    expect(await actions(applicationId)).toEqual(['review', 'schedule_interview']);
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'abstain' });
    expect(await actions(applicationId)).toEqual(['review', 'schedule_interview']);
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 4 });
    expect(await actions(applicationId)).toEqual([
      'review',
      'schedule_interview',
      'accept',
      'reject',
    ]);

    // With no reviews required, the fast rejection from SUBMITTED is offered.
    await setApplicationSettings(kit, { minReviewsBeforeDecision: 0 });
    const fast = await submittedApplicant(kit);
    expect(await actions(fast.applicationId)).toEqual(['start_review', 'review', 'reject']);
  });

  it('converges on one card that shows the newest revision', async () => {
    const bot = simulatedBot();
    const ops = await kit.member({ roles: ['operations'] });
    const { applicant, applicationId } = await submittedApplicant(kit);
    await startReview(kit.as(ops), { applicationId });
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 4 });

    const outcomes = await kit.drain(withBot(bot));
    const cardRuns = outcomes.filter((o) => o.type === APPLICATION_REVIEW_CARD_JOB);
    expect(cardRuns.filter((o) => o.result?.skipped === 'superseded')).toHaveLength(
      cardRuns.length - 1,
    );
    expect(bot.posted).toHaveLength(1);

    await withdrawApplication(kit.as(applicant));
    await kit.drain(withBot(bot));
    expect(bot.posted).toHaveLength(1);
    expect(bot.shown.at(-1)).toMatchObject({ status: 'withdrawn', actions: [] });
    const row = await cardRow(applicationId);
    expect(row.reviewMessageId).toBe(bot.posted[0]!.messageId);
    expect(row.reviewCardRenderedRevision).toBe(row.reviewCardRevision);
    expect(row.reviewCardLeaseId).toBeNull();
  });

  it('BREAK: racing renders are serialized, so a stale edit never lands after a newer one', async () => {
    const bot = simulatedBot();
    const { ops, core, applicationId } = await cardInReview(bot);

    // A review is recorded and its render reads the card (revision 3)…
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 5 });
    const reviewRender = await beginReviewCardRender(kit.system, {
      applicationId,
      revision: 3,
      renderId: 'render-review',
    });
    if (reviewRender.outcome !== 'render') throw new Error('expected a render');
    expect(reviewRender.card.status).toBe('review');

    // …while a decider accepts (revision 4). That render must wait its turn.
    await decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'Yes.' });
    await expect(
      beginReviewCardRender(kit.system, { applicationId, revision: 4, renderId: 'eager' }),
    ).rejects.toThrow(ConflictError);
    const blocked = await kit.drain(withBot(bot));
    const retry = blocked.find(
      (o) => o.type === APPLICATION_REVIEW_CARD_JOB && o.status === 'retry',
    );
    expect(retry?.error).toMatch(/Another render/);

    // The review's edit lands and reports back; the acceptance renders after it.
    await bot.finish(kit.system, reviewRender.card, bot.show(reviewRender.card)!, 'render-review');
    kit.clock.advance(PAST_FIRST_BACKOFF_MS);
    await kit.drain(withBot(bot));

    expect(bot.shown.at(-1)).toEqual({
      messageId: bot.posted[0]!.messageId,
      revision: 4,
      status: 'accepted',
      actions: [],
    });
    const row = await cardRow(applicationId);
    expect(row.reviewCardRenderedRevision).toBe(4);
    expect(row.reviewCardLeaseId).toBeNull();
  });

  it('BREAK: a render that outlives its lease is followed by a repair render', async () => {
    const bot = simulatedBot();
    const { ops, core, applicationId } = await cardInReview(bot);
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'accept', score: 5 });
    const slow = await beginReviewCardRender(kit.system, {
      applicationId,
      revision: 3,
      renderId: 'slow-render',
    });
    if (slow.outcome !== 'render') throw new Error('expected a render');

    // The slow render stalls past its lease; the acceptance takes over and renders.
    kit.clock.advance(REVIEW_CARD_RENDER_LEASE_MS + MINUTE);
    await decideApplication(kit.as(core), { applicationId, decision: 'accept', reason: 'Yes.' });
    await kit.drain(withBot(bot));
    expect(bot.shown.at(-1)).toMatchObject({ status: 'accepted', revision: 4 });

    // The slow render's stale edit lands last and it reports back late.
    await bot.finish(kit.system, slow.card, bot.show(slow.card)!, 'slow-render');
    expect(bot.shown.at(-1)).toMatchObject({ status: 'review', revision: 3 });
    const repairs = await kit.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, APPLICATION_REVIEW_CARD_JOB),
          like(jobs.dedupeKey, '%:repair:slow-render'),
        ),
      );
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.payload).toEqual({ applicationId, revision: 4 });

    await kit.drain(withBot(bot));
    expect(bot.shown.at(-1)).toMatchObject({ status: 'accepted', revision: 4, actions: [] });
    expect(bot.posted).toHaveLength(1);
    expect(bot.deleted).toEqual([]);
    const row = await cardRow(applicationId);
    expect(row.reviewCardRenderedRevision).toBe(4);
    expect(row.reviewCardLeaseId).toBeNull();
  });

  it('a failed render gives its lease back; only the holder can release it', async () => {
    const { applicationId } = await submittedApplicant(kit);
    const first = await beginReviewCardRender(kit.system, {
      applicationId,
      revision: 1,
      renderId: 'first',
    });
    expect(first.outcome).toBe('render');
    await expect(
      beginReviewCardRender(kit.system, { applicationId, revision: 1, renderId: 'second' }),
    ).rejects.toThrow(ConflictError);
    // A retry of the same job keeps its own lease.
    expect(
      (await beginReviewCardRender(kit.system, { applicationId, revision: 1, renderId: 'first' }))
        .outcome,
    ).toBe('render');

    expect(
      await releaseReviewCardRender(kit.system, { applicationId, renderId: 'second' }),
    ).toEqual({ released: false });
    expect(await releaseReviewCardRender(kit.system, { applicationId, renderId: 'first' })).toEqual(
      {
        released: true,
      },
    );
    expect((await cardRow(applicationId)).reviewCardLeaseId).toBeNull();
    expect(
      (await beginReviewCardRender(kit.system, { applicationId, revision: 1, renderId: 'second' }))
        .outcome,
    ).toBe('render');
    // The card is still behind, so the current revision's render stays queued.
    const live = await kit.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, APPLICATION_REVIEW_CARD_JOB), eq(jobs.status, 'pending')));
    expect(live.map((job) => job.payload.revision)).toEqual([1]);
  });

  it('BREAK: renders without the lease keep the newest message and schedule a repair', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const { applicationId } = await submittedApplicant(kit);
    await startReview(kit.as(ops), { applicationId });
    const record = (messageId: string, revision: number, renderId: string) =>
      recordReviewCardMessage(kit.system, {
        applicationId,
        channelId: REVIEW_CHANNEL,
        messageId,
        revision,
        renderId,
      });
    expect(await record('600000000000000001', 2, 'a')).toEqual({ discard: null });
    expect(await record('600000000000000001', 2, 'a')).toEqual({ discard: null });
    // An older render that posted a second message loses.
    expect(await record('600000000000000002', 1, 'b')).toEqual({
      discard: { channelId: REVIEW_CHANNEL, messageId: '600000000000000002' },
    });
    // A newer render that posted a second message wins; the stored one is discarded.
    await reviewApplication(kit.as(ops), { applicationId, recommendation: 'abstain' });
    expect(await record('600000000000000003', 3, 'c')).toEqual({
      discard: { channelId: REVIEW_CHANNEL, messageId: '600000000000000001' },
    });
    const row = await cardRow(applicationId);
    expect(row.reviewMessageId).toBe('600000000000000003');
    expect(row.reviewCardRenderedRevision).toBe(3);
    const repairs = await kit.db
      .select({ key: jobs.dedupeKey })
      .from(jobs)
      .where(like(jobs.dedupeKey, '%:repair:%'));
    expect(repairs.map((job) => job.key?.split(':repair:')[1]).sort()).toEqual(['a', 'b', 'c']);
  });

  it('BREAK: only the worker renders cards, and malformed render calls are refused', async () => {
    const core = await kit.member({ roles: ['core'] });
    const { applicationId } = await submittedApplicant(kit);
    const asCore = kit.as(core);
    const message = { channelId: REVIEW_CHANNEL, messageId: '600000000000000001' };
    await expect(
      beginReviewCardRender(asCore, { applicationId, revision: 1, renderId: 'r' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      recordReviewCardMessage(asCore, { applicationId, ...message, revision: 1, renderId: 'r' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(releaseReviewCardRender(asCore, { applicationId, renderId: 'r' })).rejects.toThrow(
      ForbiddenError,
    );

    await expect(
      beginReviewCardRender(kit.system, { applicationId, revision: 99, renderId: 'r' }),
    ).rejects.toThrow(ValidationError);
    await expect(
      recordReviewCardMessage(kit.system, {
        applicationId,
        ...message,
        revision: 99,
        renderId: 'r',
      }),
    ).rejects.toThrow(ValidationError);
    for (const renderId of ['', 'has space', 'x'.repeat(65), 'drop;table']) {
      await expect(
        beginReviewCardRender(kit.system, { applicationId, revision: 1, renderId }),
      ).rejects.toThrow(ValidationError);
    }
    await expect(
      recordReviewCardMessage(kit.system, {
        applicationId,
        channelId: '<#1>',
        messageId: message.messageId,
        revision: 1,
        renderId: 'r',
      }),
    ).rejects.toThrow(ValidationError);
    expect((await cardRow(applicationId)).reviewCardLeaseId).toBeNull();
  });

  it('skips cleanly when no review channel is configured, without taking the lease', async () => {
    await updateSettings(kit.system, 'channels', { applicationsReview: undefined });
    const { applicationId } = await submittedApplicant(kit);
    const bot = simulatedBot();
    const outcomes = await kit.drain(withBot(bot));
    const card = outcomes.find((o) => o.type === APPLICATION_REVIEW_CARD_JOB);
    expect(card?.result).toEqual({ skipped: 'no review channel' });
    expect(bot.shown).toEqual([]);
    expect((await cardRow(applicationId)).reviewCardLeaseId).toBeNull();
  });
});
