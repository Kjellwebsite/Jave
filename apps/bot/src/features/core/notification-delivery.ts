import { eq } from 'drizzle-orm';
import { users } from '@jave/database';
import { type JobHandler, loadDelivery, markDelivery, PermanentJobError } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { linkButton, panel, row } from '../../ui/components';
import { COLORS } from '../../ui/theme';
import { userText } from '../../ui/format';

const SEVERITY_COLOR = {
  info: COLORS.steel,
  notice: COLORS.base,
  important: COLORS.chrome,
  critical: COLORS.danger,
} as const;

function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Delivers queued notifications to Discord DMs. Closed DMs are recorded, never retried. */
export function notificationDeliveryHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const deliveryId = typeof payload.deliveryId === 'string' ? payload.deliveryId : null;
    if (!deliveryId) throw new PermanentJobError('deliveryId missing');
    const { delivery, notification } = await loadDelivery(ctx, deliveryId);
    if (delivery.status === 'sent' || delivery.status === 'skipped')
      return { skipped: `already ${delivery.status}` };
    if (delivery.channel !== 'discord_dm') {
      await markDelivery(ctx, deliveryId, {
        status: 'skipped',
        error: `${delivery.channel} is not delivered by the bot`,
      });
      return { skipped: delivery.channel };
    }
    const [recipient] = await ctx.db
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, notification.recipientUserId));
    if (!recipient) throw new PermanentJobError('recipient not found');

    const url = safeUrl(notification.url);
    const message = {
      embeds: [
        panel({
          kicker: 'JAVELIN',
          title: notification.title,
          description: userText(notification.body, 3500),
          color: SEVERITY_COLOR[notification.severity],
          timestamp: notification.createdAt,
        }),
      ],
      components: url ? [row(linkButton('Open', url))] : undefined,
    };
    try {
      const sent = await services.gateway.sendDirectMessage(recipient.discordId, message);
      if (!sent) {
        await markDelivery(ctx, deliveryId, {
          status: 'skipped',
          error: 'recipient does not accept DMs',
        });
        return { skipped: 'dm closed' };
      }
      await markDelivery(ctx, deliveryId, { status: 'sent' });
      return { messageId: sent.messageId };
    } catch (error) {
      if (error instanceof DiscordActionError && error.permanent) {
        await markDelivery(ctx, deliveryId, { status: 'failed', error: error.message });
        throw new PermanentJobError(error.message);
      }
      throw error;
    }
  };
}
