import { eq } from 'drizzle-orm';
import { webhookDeliveries } from '@jave/database';
import { integrations, type JobHandler, PermanentJobError, type ServiceContext } from '@jave/core';
import { DiscordActionError, type SentMessage } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { panel } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, LIMITS } from '../../ui/theme';

const RELAY_KICKER = 'INTEGRATION';

/** Execute jobs a callback enqueued, now rather than on the next poll. */
async function flushEffects(services: BotServices, ctx: ServiceContext): Promise<void> {
  const ids = ctx.effects.jobIds.splice(0);
  if (ids.length > 0) await services.runJobsNow(ids);
}

/**
 * `discord.integrations.relay` — post one sanitized summary of an inbound
 * generic webhook delivery to the configured channel (see
 * docs/modules/integrations.md). Idempotent: a delivery that already has a
 * relay message is skipped. No buttons, no pings.
 */
export function relayHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const parsed = integrations.relayJobPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid relay payload');
    const job = parsed.data;
    const [delivery] = await ctx.db
      .select({ relayMessageId: webhookDeliveries.relayMessageId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, job.deliveryId));
    if (!delivery) throw new PermanentJobError(`delivery ${job.deliveryId} not found`);
    if (delivery.relayMessageId) return { skipped: 'already relayed' };

    let sent: SentMessage;
    try {
      sent = await services.gateway.sendMessage(job.channelId, {
        embeds: [
          panel({
            kicker: RELAY_KICKER,
            title: userText(job.title, LIMITS.embedTitle),
            description: userText(job.text, LIMITS.embedDescription),
            color: COLORS.steel,
          }),
        ],
      });
    } catch (error) {
      if (!(error instanceof DiscordActionError && error.permanent)) throw error;
      await integrations.markRelayFailed(ctx, {
        deliveryId: job.deliveryId,
        reason: error.message.slice(0, integrations.MAX_ERROR_LENGTH),
      });
      await flushEffects(services, ctx);
      throw new PermanentJobError(error.message);
    }
    // Outside the Discord try: a failing callback (database) retries the job
    // instead of being recorded as a permanent Discord failure. Delivery is
    // at-least-once: that rare retry can post the summary a second time.
    await integrations.markRelayDelivered(ctx, {
      deliveryId: job.deliveryId,
      messageId: sent.messageId,
    });
    await flushEffects(services, ctx);
    return { messageId: sent.messageId };
  };
}
