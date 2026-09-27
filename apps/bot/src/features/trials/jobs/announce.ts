import { type JobHandler, trials } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { announcementMessage } from '../render/cards';
import { isUnknownEntity, parsePayload, toJobError, UNKNOWN } from './support';

/**
 * discord.trials.announce — post or refresh the recruitment card.
 * Idempotent: an existing card is edited in place; a card deleted by hand is
 * posted anew and reported, so later refreshes edit the new one.
 */
export function announceHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const { trialId } = parsePayload(trials.announceJobSchema, payload);
    const spec = await trials.getAnnouncementSpec(ctx, { trialId });
    if (spec.action === 'skip') return { skipped: spec.reason };
    const message = announcementMessage(spec.trialId, spec.card);
    try {
      if (spec.action === 'edit') {
        try {
          await services.gateway.editMessage(spec.channelId, spec.messageId, message);
          return { edited: spec.messageId };
        } catch (error) {
          if (!isUnknownEntity(error, UNKNOWN.message)) throw error;
        }
      }
      const sent = await services.gateway.sendMessage(spec.channelId, message);
      await trials.markAnnouncementPosted(ctx, {
        trialId: spec.trialId,
        channelId: sent.channelId,
        messageId: sent.messageId,
      });
      return { posted: sent.messageId };
    } catch (error) {
      throw toJobError(error);
    }
  };
}
