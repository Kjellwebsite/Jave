import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, verifications } from '@jave/database';
import { enqueueJob, updateSettings, type UserActor, verification } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { buttonLabels, controls, payloadText } from '../applications/testing/helpers';
import { renderQueueCard } from './queue-card';
import { createProject } from './testing/fixtures';

const QUEUE_CHANNEL = '400000000000000002';
const FLOW_TIMEOUT_MS = 60_000;

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

describe('verification — queue card job', { timeout: FLOW_TIMEOUT_MS }, () => {
  let bot: BotHarness;
  let subject: Person;
  let verificationId: string;

  async function row() {
    const [found] = await bot.kit.db
      .select()
      .from(verifications)
      .where(eq(verifications.id, verificationId));
    return found!;
  }

  async function cardPayload(): Promise<MessagePayload> {
    const current = await row();
    const message = bot.gateway.messages.get(current.queueMessageId!);
    if (!message) throw new Error('no card on record');
    return message.payload;
  }

  async function cardJobs() {
    const rows = await bot.kit.db
      .select()
      .from(jobs)
      .where(eq(jobs.type, verification.VERIFICATION_QUEUE_CARD_JOB));
    return rows.sort((a, b) => a.id - b.id);
  }

  beforeEach(async () => {
    bot = await createBotHarness();
    await updateSettings(bot.kit.system, 'channels', { verificationQueue: QUEUE_CHANNEL });
    subject = await bot.member({ roles: ['trial'], username: 'nova' });
    const projectId = await createProject(bot.kit, subject.actor.memberId!, 'Orbit **tracker**');
    await bot.run({
      kind: 'modal',
      name: customId('verification', 'submit', 'project', projectId),
      user: subject.user,
      modalText: {
        claim: '@everyone <@123456789012345678> I built it',
        evidence1: 'https://github.com/example/secret-repo',
      },
    });
    await bot.drain();
    verificationId = (await bot.kit.db.select().from(verifications))[0]!.id;
  });
  afterEach(async () => {
    await bot.close();
  });

  it('posts one escaped card without evidence URLs, with a nonce, and records it', async () => {
    const posts = bot.gateway.callsTo('sendMessageOnce');
    expect(posts).toHaveLength(1);
    const [channelId, payload, nonce] = posts[0]!.args as [string, MessagePayload, string];
    expect(channelId).toBe(QUEUE_CHANNEL);
    const [job] = await cardJobs();
    expect(nonce).toBe(`vc${job!.id}r0`);
    expect(payload.embeds![0]!.title).toBe('VER-0001 — PROJECT');
    const text = payloadText(payload);
    expect(text).toContain('PENDING');
    expect(text).toContain('Orbit \\*\\*tracker\\*\\*');
    expect(text).not.toContain('@everyone');
    expect(text).not.toMatch(/<@\d{17,20}>/);
    expect(text).not.toContain('secret-repo');
    expect(text).toContain('1 item');
    expect(buttonLabels(payload)).toEqual([
      'START REVIEW',
      'APPROVE',
      'REJECT',
      'DETAILS',
      'OPEN IN DASHBOARD',
    ]);
    const link = controls(payload).find((c) => c.type === 'link');
    expect(link?.url).toBe(`https://jave.test/verification/${verificationId}`);
    const recorded = await row();
    expect(recorded.queueChannelId).toBe(QUEUE_CHANNEL);
    expect(recorded.queueMessageId).toBeTruthy();
    expect(job!.status).toBe('completed');
  });

  it('edits the card in place through review and decision', async () => {
    const verifier = await bot.member({ roles: ['operations'], username: 'theo' });
    const first = (await row()).queueMessageId;
    await bot.run({
      kind: 'button',
      name: buttonId('claim'),
      user: verifier.user,
    });
    await bot.drain();
    const inReview = await cardPayload();
    expect((await row()).queueMessageId).toBe(first);
    expect(inReview.embeds![0]!.fields!.find((f) => f.name === 'STATUS')?.value).toBe('IN REVIEW');
    expect(payloadText(inReview)).toContain('theo');
    expect(buttonLabels(inReview)).toEqual(['APPROVE', 'REJECT', 'DETAILS', 'OPEN IN DASHBOARD']);

    await verification.decideVerification(bot.kit.as(verifier.actor), {
      verificationId,
      decision: 'reject',
      note: 'The private notes must never reach the card.',
    });
    await bot.drain();
    const decided = await cardPayload();
    expect(payloadText(decided)).toContain('REJECTED');
    expect(payloadText(decided)).not.toContain('private notes');
    expect(buttonLabels(decided)).toEqual(['DETAILS', 'OPEN IN DASHBOARD']);
    expect(bot.gateway.callsTo('sendMessageOnce')).toHaveLength(1);
  });

  function buttonId(action: string): string {
    return customId('verification', action, verificationId);
  }

  it('reposts when the recorded card was deleted', async () => {
    const first = (await row()).queueMessageId!;
    bot.gateway.messages.delete(first);
    const verifier = await bot.member({ roles: ['operations'] });
    await bot.run({ kind: 'button', name: buttonId('claim'), user: verifier.user });
    await bot.drain();
    const current = await row();
    expect(current.queueMessageId).not.toBe(first);
    expect(payloadText(await cardPayload())).toContain('IN REVIEW');
  });

  it('dead-letters on a permanent Discord failure', async () => {
    bot.gateway.failures.set(
      'editMessage',
      new DiscordActionError('edit message failed: Missing Access', 50001, true),
    );
    const verifier = await bot.member({ roles: ['operations'] });
    await bot.run({ kind: 'button', name: buttonId('claim'), user: verifier.user });
    await bot.drain();
    const last = (await cardJobs()).at(-1)!;
    expect(last.status).toBe('dead');
    expect(last.lastError).toContain('Missing Access');
  });

  it('retries transient failures and converges', async () => {
    bot.gateway.failures.set(
      'editMessage',
      new DiscordActionError('edit message failed: rate limited', 429, false),
    );
    const verifier = await bot.member({ roles: ['operations'] });
    await bot.run({ kind: 'button', name: buttonId('claim'), user: verifier.user });
    const failed = (await cardJobs()).at(-1)!;
    expect(failed.status).toBe('pending');
    expect(failed.attempts).toBe(1);
    bot.kit.clock.advance(60_000);
    await bot.drain();
    expect(payloadText(await cardPayload())).toContain('IN REVIEW');
  });

  it('keeps exactly one card when another run records first', async () => {
    const recorded = (await row()).queueMessageId!;
    bot.gateway.messages.delete(recorded);
    const rival = await bot.gateway.sendMessage(QUEUE_CHANNEL, { content: 'rival card' });
    const originalSend = bot.gateway.sendMessageOnce.bind(bot.gateway);
    bot.gateway.sendMessageOnce = async (channelId, payload, nonce) => {
      const sent = await originalSend(channelId, payload, nonce);
      await bot.kit.db
        .update(verifications)
        .set({ queueMessageId: rival.messageId })
        .where(eq(verifications.id, verificationId));
      return sent;
    };
    const verifier = await bot.member({ roles: ['operations'] });
    await bot.run({ kind: 'button', name: buttonId('claim'), user: verifier.user });
    await bot.drain();
    const deleted = bot.gateway.callsTo('deleteMessage');
    expect(deleted).toHaveLength(1);
    expect((await row()).queueMessageId).toBe(rival.messageId);
    const cards = [...bot.gateway.messages.values()].filter((m) => m.channelId === QUEUE_CHANNEL);
    expect(cards).toHaveLength(1);
    expect(payloadText(cards[0]!.payload)).toContain('IN REVIEW');
  });

  it('re-renders when the verification changed during the render', async () => {
    const verifier = await bot.member({ roles: ['operations'] });
    const originalEdit = bot.gateway.editMessage.bind(bot.gateway);
    let raced = false;
    bot.gateway.editMessage = async (channelId, messageId, payload) => {
      await originalEdit(channelId, messageId, payload);
      if (raced) return;
      raced = true;
      await bot.kit.db
        .update(verifications)
        .set({ claim: 'Changed while the card was rendering.' })
        .where(eq(verifications.id, verificationId));
    };
    await bot.run({ kind: 'button', name: buttonId('claim'), user: verifier.user });
    await bot.drain();
    expect(payloadText(await cardPayload())).toContain('Changed while the card was rendering.');
    expect(bot.gateway.callsTo('editMessage').length).toBeGreaterThanOrEqual(2);
  });

  it('skips when no queue channel is configured and no card exists', async () => {
    await updateSettings(bot.kit.system, 'channels', { verificationQueue: undefined });
    await bot.kit.db
      .update(verifications)
      .set({ queueChannelId: null, queueMessageId: null })
      .where(eq(verifications.id, verificationId));
    const before = bot.gateway.calls.length;
    await enqueueJob(bot.kit.system, verification.VERIFICATION_QUEUE_CARD_JOB, {
      verificationId,
    });
    await bot.drain();
    expect(bot.gateway.calls.length).toBe(before);
    const last = (await cardJobs()).at(-1)!;
    expect(last.status).toBe('completed');
    expect(last.result).toEqual({ skipped: 'no queue channel' });
  });

  it('BREAK: a malformed payload dead-letters immediately', async () => {
    await enqueueJob(bot.kit.system, verification.VERIFICATION_QUEUE_CARD_JOB, {
      verificationId: 'not-a-uuid',
    });
    await bot.drain();
    const last = (await cardJobs()).at(-1)!;
    expect(last.status).toBe('dead');
    expect(last.lastError).toContain('invalid queue card payload');
  });

  it('renders no dashboard link without an http(s) public URL', async () => {
    const card = await verification.getQueueCard(bot.kit.system, verificationId);
    const payload = renderQueueCard(card, 'javascript:alert(1)');
    expect(controls(payload).some((c) => c.type === 'link')).toBe(false);
    expect(renderQueueCard(card, undefined).components).toHaveLength(2);
  });
});
