import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { aiActionProposals } from '@jave/database';
import { ai, type JobHandler, PermanentJobError, truncate } from '@jave/core';
import { DiscordActionError, MESSAGE_NONCE_MAX_LENGTH } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { panel } from '../../ui/components';
import { BRAND, COLORS, GLYPH } from '../../ui/theme';

const NONCE_PREFIX = 'ai';
const MAX_DELIVERY_ERROR = 500;

/**
 * Deterministic per-proposal nonce: a retry after a send whose response was
 * lost gets Discord's already-created message back instead of a second post.
 */
export function announceNonce(proposalId: string): string {
  const digest = createHash('sha256').update(proposalId).digest('base64url');
  return `${NONCE_PREFIX}${digest}`.slice(0, MESSAGE_NONCE_MAX_LENGTH);
}

/**
 * `discord.ai.announce` — post a confirmed AI-drafted announcement.
 * Contract (core ai/discord-jobs.ts): validate the payload (dead-letter if
 * invalid); post ONE embed with mentions disabled; never post twice for one
 * proposal; report `posted` (message id) or, on a permanent Discord failure,
 * `failed` through `ai.recordAnnouncementDelivery`, then run whatever that
 * callback enqueued.
 */
export function announceHandler(services: BotServices): JobHandler {
  return async (ctx, payload, job) => {
    const parsed = ai.aiAnnouncePayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid discord.ai.announce payload');
    const { proposalId, channelId, title, body } = parsed.data;

    const [proposal] = await ctx.db
      .select({ status: aiActionProposals.status, kind: aiActionProposals.kind })
      .from(aiActionProposals)
      .where(eq(aiActionProposals.id, proposalId));
    if (!proposal || proposal.kind !== 'draft_announcement') {
      throw new PermanentJobError(`announcement proposal ${proposalId} not found`);
    }
    if (proposal.status !== 'confirmed') return { skipped: `proposal is ${proposal.status}` };

    const report = async (input: Parameters<typeof ai.recordAnnouncementDelivery>[1]) => {
      await ai.recordAnnouncementDelivery(ctx, input);
      await services.runJobsNow(ctx.effects.jobIds);
    };

    let sent;
    try {
      sent = await services.gateway.sendMessageOnce(
        channelId,
        {
          embeds: [
            panel({
              kicker: `${BRAND.organization} ${GLYPH.dot} ANNOUNCEMENT`,
              // Title and body were sanitized for Discord by core; mentions are also disabled on send.
              title,
              description: body,
              color: COLORS.chrome,
            }),
          ],
        },
        announceNonce(proposalId),
      );
    } catch (error) {
      const lastAttempt = job.attempts >= job.maxAttempts;
      const permanent = error instanceof DiscordActionError && error.permanent;
      if (permanent || lastAttempt) {
        const reason = error instanceof Error ? error.message : 'Discord refused the post.';
        await report({
          proposalId,
          outcome: 'failed',
          error: truncate(reason, MAX_DELIVERY_ERROR),
        });
        throw new PermanentJobError(reason);
      }
      throw error;
    }
    await report({ proposalId, outcome: 'posted', messageId: sent.messageId });
    return { messageId: sent.messageId, channelId: sent.channelId };
  };
}
