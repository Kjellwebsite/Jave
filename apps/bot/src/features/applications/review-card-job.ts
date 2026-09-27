import { RESTJSONErrorCodes } from 'discord.js';
import { applications, type JobHandler, PermanentJobError, type ServiceContext } from '@jave/core';
import { DiscordActionError, type SentMessage } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { renderReviewCard } from './review-card';

/** Nonce prefix for review card posts ("ar" + job id stays within Discord's 25 characters). */
const REVIEW_CARD_NONCE_PREFIX = 'ar';

const GONE_CODES: ReadonlySet<number | string | null> = new Set([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
]);

/** The stored card no longer exists: its message or its channel was deleted. */
export function isGone(error: unknown): boolean {
  return error instanceof DiscordActionError && GONE_CODES.has(error.code);
}

function asJobError(error: unknown): unknown {
  if (error instanceof DiscordActionError && error.permanent) {
    return new PermanentJobError(error.message);
  }
  return error;
}

async function release(ctx: ServiceContext, applicationId: string, renderId: string) {
  await applications
    .releaseReviewCardRender(ctx, { applicationId, renderId })
    .catch((error: unknown) =>
      ctx.logger.warn({ err: error, applicationId }, 'review card lease release failed'),
    );
}

/**
 * `discord.applications.review_card` — posts or edits the staff review card,
 * following core's render protocol: begin (takes the render lease) → edit
 * the stored message, or post a new one when it is gone → record (releases
 * the lease, queues catch-up renders) → delete a duplicate core discards.
 * Any failure before the record releases the lease and rethrows; permanent
 * Discord failures dead-letter.
 */
export function reviewCardJobHandler(services: BotServices): JobHandler {
  return async (ctx, payload, job) => {
    const parsed = applications.reviewCardJobPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid review card payload');
    const { applicationId, revision } = parsed.data;
    const renderId = String(job.id);

    const start = await applications.beginReviewCardRender(ctx, {
      applicationId,
      revision,
      renderId,
    });
    if (start.outcome === 'superseded') return { skipped: 'superseded' };
    if (start.outcome === 'no_channel') return { skipped: 'no review channel' };
    const { card } = start;

    let shown: SentMessage | null = null;
    let recorded: applications.ReviewCardRecordResult;
    try {
      const message = renderReviewCard(card, ctx.config.publicUrl);
      if (card.message) {
        try {
          await services.gateway.editMessage(
            card.message.channelId,
            card.message.messageId,
            message,
          );
          shown = card.message;
        } catch (error) {
          if (!isGone(error)) throw error;
        }
      }
      if (!shown) {
        if (!card.channelId) {
          await release(ctx, applicationId, renderId);
          return { skipped: 'no review channel' };
        }
        shown = await services.gateway.sendMessageOnce(
          card.channelId,
          message,
          `${REVIEW_CARD_NONCE_PREFIX}${job.id}`,
        );
      }
      recorded = await applications.recordReviewCardMessage(ctx, {
        applicationId,
        channelId: shown.channelId,
        messageId: shown.messageId,
        revision: card.revision,
        renderId,
      });
    } catch (error) {
      await release(ctx, applicationId, renderId);
      throw asJobError(error);
    }

    if (recorded.discard) {
      try {
        await services.gateway.deleteMessage(
          recorded.discard.channelId,
          recorded.discard.messageId,
          'JAVE: duplicate review card',
        );
      } catch (error) {
        if (!isGone(error)) throw asJobError(error);
      }
    }
    // Catch-up or repair renders the callback queued: run them now, not on the next poll.
    await services.runJobsNow(ctx.effects.jobIds);
    return {
      channelId: shown.channelId,
      messageId: shown.messageId,
      revision: card.revision,
      discarded: recorded.discard?.messageId ?? null,
    };
  };
}
