import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiActionProposals } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { MAX_PROPOSAL_ERROR_LENGTH } from './constants';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

/**
 * Discord job contract — `discord.ai.announce`.
 *
 * Enqueued by `confirmProposal` when a human with `canBroadcast` confirms an
 * AI-drafted announcement (proposal kind `draft_announcement`). Dedupe key:
 * `ai:announce:<proposalId>`.
 *
 * The bot must:
 * 1. Validate the payload with `aiAnnouncePayloadSchema`; dead-letter on failure.
 * 2. Post ONE embed to `channelId` with `title` as the embed title and `body`
 *    as the description (both already passed through `sanitizeForDiscord`),
 *    using `allowedMentions: { parse: [] }` — the announcement must never ping.
 * 3. Be idempotent: if a retry finds the message already posted (e.g. the
 *    previous attempt timed out after sending), do not post a second one.
 * 4. Report the result with `recordAnnouncementDelivery(ctx, { proposalId,
 *    outcome: 'posted', messageId })`, or `outcome: 'failed'` with a short
 *    error when Discord refuses permanently (missing channel/permissions).
 *
 * Required Discord permissions in the announcements channel: View Channel,
 * Send Messages, Embed Links. No other permissions are needed.
 */
export const DISCORD_AI_ANNOUNCE_JOB = 'discord.ai.announce';

/** Discord embed limits: title 256, description 4096. */
export const aiAnnouncePayloadSchema = z.object({
  proposalId: z.uuid(),
  channelId: snowflake,
  title: z.string().min(1).max(256),
  body: z.string().min(1).max(4096),
});
export type AiAnnouncePayload = z.infer<typeof aiAnnouncePayloadSchema>;

export const announcementDeliverySchema = z.discriminatedUnion('outcome', [
  z.object({ proposalId: z.uuid(), outcome: z.literal('posted'), messageId: snowflake }),
  z.object({
    proposalId: z.uuid(),
    outcome: z.literal('failed'),
    error: z.string().trim().min(1).max(MAX_PROPOSAL_ERROR_LENGTH),
  }),
]);

/**
 * Callback for the bot's `discord.ai.announce` handler. Moves the proposal
 * from `confirmed` (queued) to `executed` (posted) or `failed`. System actor
 * only (the bot's worker); idempotent for repeated reports.
 */
export async function recordAnnouncementDelivery(
  ctx: ServiceContext,
  input: z.input<typeof announcementDeliverySchema>,
): Promise<{ status: 'executed' | 'failed' }> {
  if (ctx.actor.kind !== 'system') {
    throw new ForbiddenError('Only the JAVE worker reports announcement delivery.');
  }
  const data = parseInput(announcementDeliverySchema, input);
  return withTransaction(ctx, async (tx) => {
    const [proposal] = await tx.db
      .select()
      .from(aiActionProposals)
      .where(eq(aiActionProposals.id, data.proposalId))
      .for('update');
    if (!proposal || proposal.kind !== 'draft_announcement') {
      throw new NotFoundError('Announcement proposal');
    }
    const target = data.outcome === 'posted' ? 'executed' : 'failed';
    if (proposal.status === target) return { status: target };
    if (proposal.status !== 'confirmed') {
      throw new InvalidStateError(`Announcement proposal is ${proposal.status}.`);
    }
    const now = tx.clock.now();
    await tx.db
      .update(aiActionProposals)
      .set(
        data.outcome === 'posted'
          ? {
              status: 'executed',
              executedAt: now,
              result: { ...proposal.result, messageId: data.messageId },
            }
          : { status: 'failed', error: truncate(data.error, MAX_PROPOSAL_ERROR_LENGTH) },
      )
      .where(and(eq(aiActionProposals.id, proposal.id), eq(aiActionProposals.status, 'confirmed')));
    await recordAudit(tx, {
      action: data.outcome === 'posted' ? 'ai.announcement_posted' : 'ai.announcement_failed',
      targetType: 'ai_proposal',
      targetId: proposal.id,
      context: data.outcome === 'posted' ? { messageId: data.messageId } : { error: data.error },
      result: data.outcome === 'posted' ? 'success' : 'failure',
    });
    return { status: target };
  });
}
