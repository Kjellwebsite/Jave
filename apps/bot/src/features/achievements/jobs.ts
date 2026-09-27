import { RESTJSONErrorCodes } from 'discord.js';
import { achievements, isSnowflake, type JobHandler, PermanentJobError } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { renderAnnouncement } from './render';

const DUPLICATE_REASON = 'Duplicate achievement card';

/** Discord answers these when the message or its channel no longer exists. */
const GONE_CODES = new Set<number | string>([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
]);

export function isGone(error: unknown): boolean {
  return error instanceof DiscordActionError && error.code !== null && GONE_CODES.has(error.code);
}

/** Permanent Discord failures dead-letter; everything else is retried. */
export function asJobError(error: unknown): unknown {
  if (error instanceof DiscordActionError && error.permanent)
    return new PermanentJobError(error.message);
  return error;
}

/**
 * Delete a card a job just posted but may not keep. A failure here leaves a
 * duplicate card behind, so it is logged with the ids for cleanup.
 */
export async function deletePosted(
  services: BotServices,
  channelId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  try {
    await services.gateway.deleteMessage(channelId, messageId, reason);
  } catch (error) {
    if (isGone(error)) return;
    services.logger.error(
      { err: error, channelId, messageId },
      'could not delete a duplicate card',
    );
  }
}

/** `discord.achievements.announce` — post the public unlock card, then report it. */
export function announceAchievementHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const parsed = achievements.achievementAnnouncePayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid achievement announce payload');
    const { memberAchievementId, channelId } = parsed.data;
    const card = await achievements.getAchievementAnnouncement(ctx, { memberAchievementId });
    if (!card) return { skipped: 'not announceable' };
    const message = renderAnnouncement({
      memberDiscordId: isSnowflake(card.memberDiscordId) ? card.memberDiscordId : null,
      memberDisplayName: card.memberDisplayName,
      memberHandle: card.memberHandle,
      title: card.title,
      line: card.line,
      description: card.description,
      rarity: card.rarity,
    });
    let messageId: string;
    try {
      ({ messageId } = await services.gateway.sendMessage(channelId, message));
    } catch (error) {
      throw asJobError(error);
    }
    let stored: boolean;
    try {
      ({ stored } = await achievements.markAchievementAnnounced(ctx, {
        memberAchievementId,
        channelId,
        messageId,
      }));
    } catch (error) {
      // Nothing was stored: remove the card so the retry starts from a clean slate.
      await deletePosted(services, channelId, messageId, DUPLICATE_REASON);
      throw error;
    }
    if (!stored) {
      await deletePosted(services, channelId, messageId, DUPLICATE_REASON);
      return { skipped: 'already announced' };
    }
    // A revocation that landed while the card was posting queued its retraction with the report.
    await services.runJobsNow(ctx.effects.jobIds);
    return { messageId };
  };
}

/** `discord.achievements.retract` — delete the card of a revoked award. Gone already = done. */
export function retractAchievementHandler(services: BotServices): JobHandler {
  return async (_ctx, payload) => {
    const parsed = achievements.achievementRetractPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid achievement retract payload');
    const { channelId, messageId } = parsed.data;
    try {
      await services.gateway.deleteMessage(channelId, messageId, 'Achievement revoked');
    } catch (error) {
      if (isGone(error)) return { skipped: 'already gone' };
      throw asJobError(error);
    }
    return { deleted: messageId };
  };
}
