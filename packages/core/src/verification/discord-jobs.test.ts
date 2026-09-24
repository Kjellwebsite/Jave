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
import { enableQueueChannel } from './testing/fixtures';

async function cardJobs(kit: TestKit) {
  return kit.db.select().from(jobs).where(eq(jobs.type, VERIFICATION_QUEUE_CARD_JOB));
}

describe('discord.verification.queue_card contract', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
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
    expect(card.subject.memberId).toBe(subject.memberId);
  });

  it('the bot callback records the posted card; later cards edit that message', async () => {
    await enableQueueChannel(kit, '223456789012345678');
    const subject = await kit.member();
    const requested = await requestVerification(kit.as(subject), { target: { type: 'identity' } });
    const worker = kit.as(systemActor('job'));
    await markQueueCardPosted(worker, {
      verificationId: requested.id,
      channelId: '223456789012345678',
      messageId: '323456789012345678',
    });
    const card = await getQueueCard(worker, requested.id);
    expect(card).toMatchObject({
      channelId: '223456789012345678',
      messageId: '323456789012345678',
    });
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
    const input = {
      verificationId: requested.id,
      channelId: '223456789012345678',
      messageId: '323456789012345678',
    };
    await expect(markQueueCardPosted(kit.as(ops), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markQueueCardPosted(kit.as(subject), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getQueueCard(kit.as(subject), requested.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const worker = kit.as(systemActor('job'));
    await expect(
      markQueueCardPosted(worker, { ...input, messageId: '<@&everyone>' }),
    ).rejects.toBeInstanceOf(ValidationError);
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
