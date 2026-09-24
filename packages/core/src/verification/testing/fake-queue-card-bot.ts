import type { JobHandler } from '../../jobs/worker';
import {
  getQueueCard,
  markQueueCardPosted,
  QUEUE_CARD_MAX_RENDERS,
  queueCardJobPayloadSchema,
} from '../discord-jobs';

/**
 * MOCK / DEVELOPMENT ONLY — an in-memory Discord channel and a bot handler
 * that follows the `discord.verification.queue_card` contract step by step.
 * Used to prove the contract holds when several card jobs run at once. The
 * real handler lives in the bot and talks to Discord.
 */

const FIRST_FAKE_MESSAGE_ID = 900_000_000_000_000_000n;

/** Yield to the event loop so concurrent jobs interleave like real network calls. */
const networkDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface FakeQueueChannel {
  /** messageId → rendered card revision. */
  messages: Map<string, string>;
  post: (revision: string) => Promise<string>;
  /** False when the message no longer exists (Discord: Unknown Message). */
  edit: (messageId: string, revision: string) => Promise<boolean>;
  remove: (messageId: string) => Promise<void>;
}

export function createFakeQueueChannel(): FakeQueueChannel {
  const messages = new Map<string, string>();
  let lastId = FIRST_FAKE_MESSAGE_ID;
  return {
    messages,
    async post(revision) {
      await networkDelay();
      lastId += 1n;
      const messageId = lastId.toString();
      messages.set(messageId, revision);
      return messageId;
    },
    async edit(messageId, revision) {
      await networkDelay();
      if (!messages.has(messageId)) return false;
      messages.set(messageId, revision);
      return true;
    },
    async remove(messageId) {
      await networkDelay();
      messages.delete(messageId);
    },
  };
}

export function fakeQueueCardHandler(channel: FakeQueueChannel): JobHandler {
  return async (ctx, payload) => {
    const { verificationId } = queueCardJobPayloadSchema.parse(payload);
    for (let render = 0; render < QUEUE_CARD_MAX_RENDERS; render++) {
      const card = await getQueueCard(ctx, verificationId);
      if (!card.channelId) return { skipped: 'no_channel' };
      const edited = card.messageId ? await channel.edit(card.messageId, card.revision) : false;
      const messageId =
        edited && card.messageId ? card.messageId : await channel.post(card.revision);
      const report = await markQueueCardPosted(ctx, {
        verificationId,
        channelId: card.channelId,
        messageId,
        previousMessageId: card.messageId,
        revision: card.revision,
      });
      if (!report.recorded && !edited) await channel.remove(messageId);
      if (report.recorded && !report.stale) return { messageId, renders: render + 1 };
    }
    throw new Error('The queue card is still out of date. Retrying later.');
  };
}
