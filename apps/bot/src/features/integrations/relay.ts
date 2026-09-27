import { eq } from 'drizzle-orm';
import { webhookDeliveries } from '@jave/database';
import { integrations, type JobHandler, PermanentJobError, type ServiceContext } from '@jave/core';
import { DiscordActionError, type SentMessage } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { panel } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, LIMITS } from '../../ui/theme';

const RELAY_KICKER = 'INTEGRATION';
/**
 * Message nonce prefix: with the job id it stays well inside Discord's
 * 25-character nonce limit and is stable across retries of the same job.
 */
const RELAY_NONCE_PREFIX = 'ir';

/** Execute jobs a callback enqueued, now rather than on the next poll. */
async function flushEffects(services: BotServices, ctx: ServiceContext): Promise<void> {
  const ids = ctx.effects.jobIds.splice(0);
  if (ids.length > 0) await services.runJobsNow(ids);
}

/**
 * `discord.integrations.relay` — post one sanitized summary of an inbound
 * generic webhook delivery to the configured channel (see
 * docs/modules/integrations.md). No buttons, no pings.
 *
 * Idempotent twice over: a delivery that already has a relay message is
 * skipped, and the post itself carries a nonce derived from the job id, so a
 * retry after Discord accepted the message but before the callback committed
 * gets the same message back instead of posting a duplicate.
 */
export function relayHandler(services: BotServices): JobHandler {
  return async (ctx, payload, job) => {
    const parsed = integrations.relayJobPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid relay payload');
    const relay = parsed.data;
    const [delivery] = await ctx.db
      .select({ relayMessageId: webhookDeliveries.relayMessageId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, relay.deliveryId));
    if (!delivery) throw new PermanentJobError(`delivery ${relay.deliveryId} not found`);
    if (delivery.relayMessageId) return { skipped: 'already relayed' };

    let sent: SentMessage;
    try {
      sent = await services.gateway.sendMessageOnce(
        relay.channelId,
        {
          embeds: [
            panel({
              kicker: RELAY_KICKER,
              title: userText(relay.title, LIMITS.embedTitle),
              description: userText(relay.text, LIMITS.embedDescription),
              color: COLORS.steel,
            }),
          ],
        },
        `${RELAY_NONCE_PREFIX}${job.id}`,
      );
    } catch (error) {
      if (!(error instanceof DiscordActionError && error.permanent)) throw error;
      await integrations.markRelayFailed(ctx, {
        deliveryId: relay.deliveryId,
        reason: error.message.slice(0, integrations.MAX_ERROR_LENGTH),
      });
      await flushEffects(services, ctx);
      throw new PermanentJobError(error.message);
    }
    // Outside the Discord try: a failing callback (database) retries the job
    // instead of being recorded as a permanent Discord failure; the nonce
    // makes that retry return the message already posted.
    await integrations.markRelayDelivered(ctx, {
      deliveryId: relay.deliveryId,
      messageId: sent.messageId,
    });
    await flushEffects(services, ctx);
    return { messageId: sent.messageId };
  };
}
