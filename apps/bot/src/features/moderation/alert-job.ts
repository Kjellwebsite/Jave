import { eq } from 'drizzle-orm';
import { securityEvents } from '@jave/database';
import { type JobHandler, moderation, PermanentJobError } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { alertCardPayload } from './alert-card';

async function postedCard(
  services: BotServices,
  securityEventId: string,
): Promise<{ channelId: string; messageId: string } | null> {
  const [row] = await services.db
    .select({ channelId: securityEvents.alertChannelId, messageId: securityEvents.alertMessageId })
    .from(securityEvents)
    .where(eq(securityEvents.id, securityEventId));
  return row?.channelId && row.messageId
    ? { channelId: row.channelId, messageId: row.messageId }
    : null;
}

/**
 * `discord.moderation.alert` — post or refresh the staff security card. The
 * card always renders the event's current state (`getSecurityAlertCard`).
 * Idempotent: a post whose card already exists (a retried job after a crash)
 * edits that card instead of posting a second one.
 */
export function moderationAlertHandler(services: BotServices): JobHandler {
  return async (ctx, rawPayload) => {
    const parsed = moderation.moderationAlertPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) throw new PermanentJobError('invalid discord.moderation.alert payload');
    const payload = parsed.data;
    const card = await moderation.getSecurityAlertCard(ctx, payload.securityEventId);
    const message = alertCardPayload(card);
    try {
      const existing =
        payload.mode === 'update' && payload.messageId
          ? { channelId: payload.channelId, messageId: payload.messageId }
          : await postedCard(services, payload.securityEventId);
      if (existing) {
        await services.gateway.editMessage(existing.channelId, existing.messageId, message);
        return { mode: 'update', messageId: existing.messageId };
      }
      if (payload.mode === 'update') throw new PermanentJobError('update without a card to edit');
      const sent = await services.gateway.sendMessage(payload.channelId, message);
      await moderation.markSecurityAlertPosted(ctx, {
        securityEventId: payload.securityEventId,
        channelId: sent.channelId,
        messageId: sent.messageId,
      });
      // A review that committed while this card was in flight found no card to
      // edit, so it queued no refresh: converge on the current state here.
      const latest = await moderation.getSecurityAlertCard(ctx, payload.securityEventId);
      if (latest.status !== card.status) {
        await services.gateway.editMessage(
          sent.channelId,
          sent.messageId,
          alertCardPayload(latest),
        );
      }
      return { mode: 'post', messageId: sent.messageId };
    } catch (error) {
      if (error instanceof DiscordActionError && error.permanent) {
        throw new PermanentJobError(error.message);
      }
      throw error;
    }
  };
}
