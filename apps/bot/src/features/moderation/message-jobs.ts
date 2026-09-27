import { RESTJSONErrorCodes } from 'discord.js';
import {
  DAY,
  getSettings,
  type JobHandler,
  moderation,
  PermanentJobError,
  snowflakeToDate,
  TtlCache,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { field, panel } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS } from '../../ui/theme';

/** Discord bulk-deletes only messages younger than 14 days. */
export const BULK_DELETE_MAX_AGE_MS = 14 * DAY;
/** Margin so a message does not cross the 14-day line mid-request. */
const BULK_DELETE_MARGIN_MS = 60_000;

function permanent(error: unknown): never {
  if (error instanceof DiscordActionError && error.permanent) {
    throw new PermanentJobError(error.message);
  }
  throw error;
}

/**
 * `discord.moderation.delete_messages` — delete automod-flagged messages.
 * Bulk delete for recent batches, one by one for the rest; a message that is
 * already gone counts as deleted.
 */
export function moderationDeleteMessagesHandler(services: BotServices): JobHandler {
  return async (ctx, rawPayload) => {
    const parsed = moderation.moderationDeleteMessagesPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
      throw new PermanentJobError('invalid discord.moderation.delete_messages payload');
    }
    const { channelId, messageIds, auditReason } = parsed.data;
    const cutoff = ctx.clock.now().getTime() - BULK_DELETE_MAX_AGE_MS + BULK_DELETE_MARGIN_MS;
    const recent = messageIds.filter((id) => snowflakeToDate(id).getTime() > cutoff);
    const old = messageIds.filter((id) => !recent.includes(id));
    const single = recent.length === 1 ? recent : [];
    let deleted = 0;
    try {
      if (recent.length > 1) {
        await services.gateway.deleteMessages(channelId, recent, auditReason);
        deleted += recent.length;
      }
      for (const messageId of [...single, ...old]) {
        try {
          await services.gateway.deleteMessage(channelId, messageId, auditReason);
          deleted++;
        } catch (error) {
          const gone =
            error instanceof DiscordActionError && error.code === RESTJSONErrorCodes.UnknownMessage;
          if (!gone) throw error;
        }
      }
    } catch (error) {
      permanent(error);
    }
    return { deleted, requested: messageIds.length };
  };
}

/**
 * `discord.moderation.lockdown` — mirror raid mode in Discord with a staff
 * notice. Converges to the *current* setting: a job whose flag no longer
 * matches (raid mode flipped again since) posts nothing, so exactly one
 * notice describes the final state. Pausing invites is not automated (see
 * docs/commands/moderation.md).
 */
export function moderationLockdownHandler(services: BotServices): JobHandler {
  return async (ctx, rawPayload) => {
    const parsed = moderation.moderationLockdownPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) throw new PermanentJobError('invalid discord.moderation.lockdown payload');
    const { enabled, reason, noticeChannelId } = parsed.data;
    // Read the committed value, not this process's settings cache: raid mode
    // may have been switched from the dashboard seconds ago.
    const security = await getSettings({ ...ctx, cache: new TtlCache() }, 'security');
    if (security.raidMode !== enabled) return { skipped: 'superseded' };
    if (!noticeChannelId) return { skipped: 'no notice channel' };
    try {
      await services.gateway.sendMessage(noticeChannelId, {
        embeds: [
          panel({
            kicker: 'JAVE SECURITY',
            title: enabled ? 'RAID MODE — ON' : 'RAID MODE — OFF',
            description: enabled
              ? 'Every new join is quarantined for review until raid mode is switched off.'
              : 'New joins are no longer held. Release held members from their history.',
            color: enabled ? COLORS.danger : COLORS.success,
            fields: [field('Reason', userText(reason))],
            timestamp: ctx.clock.now(),
          }),
        ],
      });
    } catch (error) {
      permanent(error);
    }
    return { posted: true, enabled };
  };
}
