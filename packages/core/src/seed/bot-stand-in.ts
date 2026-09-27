import type { JobHandler } from '../jobs/worker';
import {
  DISCORD_MODERATION_APPLY_JOB,
  getCaseForSync,
  markCaseSynced,
  moderationApplyPayloadSchema,
} from '../moderation';
import { markDelivery, NOTIFICATION_DELIVER_JOB } from '../notifications/notifications.service';

/**
 * MOCK / DEVELOPMENT ONLY — the seed runs without Discord.
 *
 * Jobs addressed to the bot are completed here instead of lingering in the
 * queue for a bot that would act on fictional Discord IDs:
 *
 * - `discord.moderation.apply`: in the seeded story the members are in the
 *   fictional server, so the bot's callback is played (`markCaseSynced`
 *   applied, after `getCaseForSync` confirms the case is still in force).
 *   Otherwise every seeded case would read "sync pending" forever.
 * - `notifications.deliver`: the DM is recorded as skipped (`markDelivery`).
 * - every other bot job completes as skipped. Channels for posts are not
 *   configured in the seed, so the bot would have skipped them too.
 */
export const SEED_SKIP_REASON = 'development seed: no Discord connection';

const simulatedModerationApply: JobHandler = async (ctx, payload) => {
  const data = moderationApplyPayloadSchema.parse(payload);
  const state = await getCaseForSync(ctx, data.caseId);
  if (!state.apply) return { skipped: state.reason };
  await markCaseSynced(ctx, { caseId: data.caseId, status: 'applied' });
  return { simulated: 'applied' };
};

const skippedDelivery: JobHandler = async (ctx, payload) => {
  if (typeof payload.deliveryId === 'string') {
    await markDelivery(ctx, payload.deliveryId, { status: 'skipped', error: SEED_SKIP_REASON });
  }
  return { skipped: SEED_SKIP_REASON };
};

const skipped: JobHandler = async () => ({ skipped: SEED_SKIP_REASON });

/** The stand-in handler for a bot-side job type. */
export function botStandIn(type: string): JobHandler {
  if (type === DISCORD_MODERATION_APPLY_JOB) return simulatedModerationApply;
  if (type === NOTIFICATION_DELIVER_JOB) return skippedDelivery;
  return skipped;
}
