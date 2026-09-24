import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, verifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ForbiddenError,
  isUniqueViolation,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { systemActor } from '../permissions/actor';
import {
  assignVerifier,
  decideVerification,
  getQueueCard,
  markQueueCardPosted,
  queueCardJobPayloadSchema,
  requestVerification,
  startReview,
  VERIFICATION_QUEUE_CARD_JOB,
} from './index';
import { enableQueueChannel, KIT_SETUP_TIMEOUT_MS, KIT_TEST_OPTIONS } from './testing/fixtures';
import { createFakeQueueChannel, fakeQueueCardHandler } from './testing/fake-queue-card-bot';

const CHANNEL_ID = '223456789012345678';
const FIRST_MESSAGE_ID = '323456789012345678';
const SECOND_MESSAGE_ID = '423456789012345678';

async function cardJobs(kit: TestKit) {
  return kit.db.select().from(jobs).where(eq(jobs.type, VERIFICATION_QUEUE_CARD_JOB));
}

describe('discord.verification.queue_card contract', KIT_TEST_OPTIONS, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, KIT_SETUP_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  it('is a discord.* job with a strict payload schema', () => {
    expect(VERIFICATION_QUEUE_CARD_JOB).toBe('discord.verification.queue_card');
    expect(queueCardJobPayloadSchema.safeParse({ verificationId: 'x' }).success).toBe(false);
  });

  it('enqueues one card job per distinct card state when the queue channel is set', async () => {
    const channelId = await enableQueueChannel(kit);
    const subject = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    await assignVerifier(kit.as(ops), {
      verificationId: requested.id,
      verifierMemberId: ops.memberId!,
    });
    await startReview(kit.as(ops), { verificationId: requested.id });
    await decideVerification(kit.as(ops), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Confirmed.',
    });
    const queued = await cardJobs(kit);
    expect(queued.map((j) => j.dedupeKey)).toEqual([
      `verification-card:${requested.id}:pending:none`,
      `verification-card:${requested.id}:pending:${ops.userId}`,
      `verification-card:${requested.id}:in_review:${ops.userId}`,
      `verification-card:${requested.id}:approved:${ops.userId}`,
    ]);
    for (const job of queued) expect(job.payload).toEqual({ verificationId: requested.id });

    const card = await getQueueCard(kit.as(systemActor('worker')), requested.id);
    expect(card).toMatchObject({
      reference: requested.reference,
      typeLabel: 'IDENTITY',
      status: 'approved',
      statusLabel: 'APPROVED',
      assignedVerifierName: ops.displayName,
      openedBy: 'subject',
      evidenceCount: 0,
      channelId,
      messageId: null,
    });
    expect(card.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(card.subject.memberId).toBe(subject.memberId);
  });

  it('the bot callback records the posted card; later renders edit that message', async () => {
    await enableQueueChannel(kit, CHANNEL_ID);
    const subject = await kit.member();
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const worker = kit.as(systemActor('job'));
    const first = await getQueueCard(worker, requested.id);
    const report = await markQueueCardPosted(worker, {
      verificationId: requested.id,
      channelId: CHANNEL_ID,
      messageId: FIRST_MESSAGE_ID,
      previousMessageId: first.messageId,
      revision: first.revision,
    });
    expect(report).toEqual({ recorded: true, stale: false });
    const card = await getQueueCard(worker, requested.id);
    expect(card).toMatchObject({ channelId: CHANNEL_ID, messageId: FIRST_MESSAGE_ID });
    expect(card.revision).toBe(first.revision);
  });

  it('BREAK: two runs that both saw no card cannot both record one (compare-and-set)', async () => {
    await enableQueueChannel(kit, CHANNEL_ID);
    const subject = await kit.member();
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const worker = kit.as(systemActor('job'));
    const seenByA = await getQueueCard(worker, requested.id);
    const seenByB = await getQueueCard(worker, requested.id);
    const common = { verificationId: requested.id, channelId: CHANNEL_ID };
    expect(
      await markQueueCardPosted(worker, {
        ...common,
        messageId: FIRST_MESSAGE_ID,
        previousMessageId: seenByA.messageId,
        revision: seenByA.revision,
      }),
    ).toEqual({ recorded: true, stale: false });
    expect(
      await markQueueCardPosted(worker, {
        ...common,
        messageId: SECOND_MESSAGE_ID,
        previousMessageId: seenByB.messageId,
        revision: seenByB.revision,
      }),
    ).toEqual({ recorded: false, stale: true });
    expect((await getQueueCard(worker, requested.id)).messageId).toBe(FIRST_MESSAGE_ID);

    // Discord lost the recorded message: the bot posts a replacement over it.
    expect(
      await markQueueCardPosted(worker, {
        ...common,
        messageId: SECOND_MESSAGE_ID,
        previousMessageId: FIRST_MESSAGE_ID,
        revision: seenByB.revision,
      }),
    ).toEqual({ recorded: true, stale: false });
    expect((await getQueueCard(worker, requested.id)).messageId).toBe(SECOND_MESSAGE_ID);
  });

  it('BREAK: a render taken before a state change is reported stale', async () => {
    await enableQueueChannel(kit, CHANNEL_ID);
    const subject = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const worker = kit.as(systemActor('job'));
    const before = await getQueueCard(worker, requested.id);
    await startReview(kit.as(ops), { verificationId: requested.id });
    const report = await markQueueCardPosted(worker, {
      verificationId: requested.id,
      channelId: CHANNEL_ID,
      messageId: FIRST_MESSAGE_ID,
      previousMessageId: null,
      revision: before.revision,
    });
    expect(report).toEqual({ recorded: true, stale: true });
    const after = await getQueueCard(worker, requested.id);
    expect(after.revision).not.toBe(before.revision);
    expect(
      await markQueueCardPosted(worker, {
        verificationId: requested.id,
        channelId: CHANNEL_ID,
        messageId: FIRST_MESSAGE_ID,
        previousMessageId: FIRST_MESSAGE_ID,
        revision: after.revision,
      }),
    ).toEqual({ recorded: true, stale: false });
  });

  it('BREAK: concurrent card jobs for one verification leave exactly one fresh card', async () => {
    await enableQueueChannel(kit, CHANNEL_ID);
    const subject = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    await assignVerifier(kit.as(ops), {
      verificationId: requested.id,
      verifierMemberId: ops.memberId!,
    });
    await startReview(kit.as(ops), { verificationId: requested.id });
    expect(await cardJobs(kit)).toHaveLength(3);

    const channel = createFakeQueueChannel();
    const outcomes = await kit.drain({
      [VERIFICATION_QUEUE_CARD_JOB]: fakeQueueCardHandler(channel),
    });
    expect(outcomes.map((o) => o.status)).toEqual(['completed', 'completed', 'completed']);
    const card = await getQueueCard(kit.as(systemActor('job')), requested.id);
    expect([...channel.messages.entries()]).toEqual([[card.messageId, card.revision]]);
    expect(card.status).toBe('in_review');

    await decideVerification(kit.as(ops), {
      verificationId: requested.id,
      decision: 'approve',
      note: 'Confirmed.',
    });
    await kit.drain({ [VERIFICATION_QUEUE_CARD_JOB]: fakeQueueCardHandler(channel) });
    const decided = await getQueueCard(kit.as(systemActor('job')), requested.id);
    expect(decided.messageId).toBe(card.messageId);
    expect([...channel.messages.entries()]).toEqual([[decided.messageId, decided.revision]]);
  });

  it('enqueues nothing when no channel is configured and no card exists', async () => {
    const subject = await kit.member();
    await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    expect(await cardJobs(kit)).toHaveLength(0);
  });

  it('BREAK: only the worker may report cards; only verifiers may read them', async () => {
    const subject = await kit.member();
    const ops = await kit.member({ roles: ['operations'] });
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const { revision } = await getQueueCard(kit.as(ops), requested.id);
    const input = {
      verificationId: requested.id,
      channelId: CHANNEL_ID,
      messageId: FIRST_MESSAGE_ID,
      previousMessageId: null,
      revision,
    };
    await expect(markQueueCardPosted(kit.as(ops), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markQueueCardPosted(kit.as(subject), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getQueueCard(kit.as(subject), requested.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const worker = kit.as(systemActor('job'));
    for (const hostile of [
      { messageId: '<@&everyone>' },
      { previousMessageId: '<@&everyone>' },
      { revision: 'ABCDEF0123456789' },
      { revision: `${revision}0` },
    ]) {
      await expect(markQueueCardPosted(worker, { ...input, ...hostile })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(
      markQueueCardPosted(worker, { ...input, verificationId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getQueueCard(kit.as(ops), requested.id)).messageId).toBeNull();
  });

  it('BREAK: the database itself allows only one open verification per target', async () => {
    const subject = await kit.member();
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const [row] = await kit.db
      .select()
      .from(verifications)
      .where(eq(verifications.id, requested.id));
    const duplicate = {
      type: row!.type,
      subjectMemberId: row!.subjectMemberId,
      claim: 'bypassing the service',
      targetKey: row!.targetKey,
      targetLabel: row!.targetLabel,
    };
    const error = await kit.db
      .insert(verifications)
      .values(duplicate)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'verifications_open_target_uq')).toBe(true);
    // Closed verifications do not block the key.
    await kit.db.update(verifications).set({ status: 'rejected' });
    await kit.db.insert(verifications).values(duplicate);
  });
});
