import { type JobHandler, missions, PermanentJobError } from '@jave/core';
import type { BotServices } from '../../runtime';
import { asJobError, deletePosted, isGone } from '../achievements/jobs';
import { renderMissionCard } from './render';

const DUPLICATE_REASON = 'Duplicate mission card';

/**
 * `discord.missions.announce` — post the mission card with its ACCEPT
 * button, then report it. Only an open, not yet announced mission is posted.
 */
export function announceMissionHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const parsed = missions.missionAnnouncePayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid mission announce payload');
    const { missionId, channelId } = parsed.data;
    const card = await missions.getMissionCard(ctx, { missionId });
    if (!card) return { skipped: 'unknown or draft mission' };
    if (card.announcement) return { skipped: 'already announced' };
    if (card.status !== 'open') return { skipped: `mission is ${card.status}` };
    let messageId: string;
    try {
      ({ messageId } = await services.gateway.sendMessage(channelId, renderMissionCard(card)));
    } catch (error) {
      throw asJobError(error);
    }
    let stored: boolean;
    try {
      ({ stored } = await missions.markMissionAnnounced(ctx, { missionId, channelId, messageId }));
    } catch (error) {
      // Nothing was stored: remove the card so the retry starts from a clean slate.
      await deletePosted(services, channelId, messageId, DUPLICATE_REASON);
      throw error;
    }
    if (!stored) {
      await deletePosted(services, channelId, messageId, DUPLICATE_REASON);
      return { skipped: 'already announced' };
    }
    // A state change that landed while the card was posting queued a refresh with the report.
    await services.runJobsNow(ctx.effects.jobIds);
    return { messageId };
  };
}

/**
 * `discord.missions.refresh_card` — re-render a posted card from the
 * mission's current state. A card deleted by hand is left alone.
 */
export function refreshMissionCardHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const parsed = missions.missionRefreshCardPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid mission refresh payload');
    const card = await missions.getMissionCard(ctx, { missionId: parsed.data.missionId });
    if (!card?.announcement) return { skipped: 'no card' };
    const { channelId, messageId } = card.announcement;
    try {
      await services.gateway.editMessage(channelId, messageId, renderMissionCard(card));
    } catch (error) {
      if (isGone(error)) return { skipped: 'card deleted' };
      throw asJobError(error);
    }
    return { edited: messageId, status: card.status };
  };
}
