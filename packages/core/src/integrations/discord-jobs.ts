import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { integrations, webhookDeliveries } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { MAX_ERROR_LENGTH } from './constants';
import { cleanLine, neutralizeMentions } from './payload';

/**
 * Discord job contracts owned by the integrations module. Core enqueues;
 * the bot (apps/bot, feature "integrations") implements the handlers.
 */

export const RELAY_TITLE_MAX = 100;
export const RELAY_TEXT_MAX = 1500;

/**
 * `discord.integrations.relay` — post a sanitized summary of an inbound
 * generic webhook delivery to a configured Discord channel.
 *
 * Bot responsibilities:
 *  1. Validate the payload with `relayJobPayloadSchema` (dead-letter if invalid).
 *  2. Send ONE message to `channelId`: a `panel()` embed titled `title`
 *     (uppercase kicker "INTEGRATION") whose description is
 *     `userText(text)` — markdown escaped. `text` is already mention-neutralized
 *     and control-character free; still send with `allowedMentions: { parse: [] }`.
 *     Never add buttons or ping anyone.
 *  3. Report back: `integrations.markRelayDelivered(ctx, { deliveryId, messageId })`
 *     on success, or `integrations.markRelayFailed(ctx, { deliveryId, reason })`
 *     for a permanent failure (unknown channel, missing access). Transient
 *     Discord errors should throw so the job retries with backoff.
 *  4. Idempotency: the job is enqueued with dedupeKey `relay:<deliveryId>`; if a
 *     retry finds the delivery already relayed (`relayMessageId` set), skip.
 *
 * Required Discord permissions in the target channel:
 *   View Channel, Send Messages, Embed Links.
 */
export const DISCORD_INTEGRATIONS_RELAY_JOB = 'discord.integrations.relay';

export const relayJobPayloadSchema = z.object({
  deliveryId: z.uuid(),
  channelId: z.string().regex(/^\d{17,20}$/),
  title: z.string().min(1).max(RELAY_TITLE_MAX),
  text: z.string().min(1).max(RELAY_TEXT_MAX),
});

export type RelayJobPayload = z.infer<typeof relayJobPayloadSchema>;

/** Plain, single-purpose text: controls stripped, mentions neutralized, bounded. */
export function sanitizeRelayText(value: string, max: number): string {
  return neutralizeMentions(cleanLine(value, max)).slice(0, max);
}

const SUMMARY_FIELDS = ['text', 'message', 'summary', 'title', 'description'] as const;
const FALLBACK_SUMMARY = 'Event received.';

/** Best human summary of an arbitrary JSON payload: first top-level text field. */
export function relaySummary(payload: unknown): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const field of SUMMARY_FIELDS) {
      const value = record[field];
      // Sanitize first: a field of only control characters must not yield empty text.
      const text = typeof value === 'string' ? sanitizeRelayText(value, RELAY_TEXT_MAX) : '';
      if (text.length > 0) return text;
    }
  }
  return FALLBACK_SUMMARY;
}

export function buildRelayPayload(input: {
  deliveryId: string;
  channelId: string;
  integrationName: string;
  eventType: string;
  payload: unknown;
}): RelayJobPayload {
  return relayJobPayloadSchema.parse({
    deliveryId: input.deliveryId,
    channelId: input.channelId,
    title: sanitizeRelayText(`${input.integrationName} · ${input.eventType}`, RELAY_TITLE_MAX),
    text: relaySummary(input.payload),
  });
}

function requireSystem(ctx: ServiceContext): void {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
}

export const markRelayDeliveredSchema = z.object({
  deliveryId: z.uuid(),
  messageId: z.string().regex(/^\d{17,20}$/),
});

export const markRelayFailedSchema = z.object({
  deliveryId: z.uuid(),
  reason: z.string().min(1).max(MAX_ERROR_LENGTH),
});

/** Bot callback: the relay message was posted. Idempotent. */
export async function markRelayDelivered(
  ctx: ServiceContext,
  input: z.input<typeof markRelayDeliveredSchema>,
): Promise<void> {
  requireSystem(ctx);
  const data = parseInput(markRelayDeliveredSchema, input);
  const [row] = await ctx.db
    .update(webhookDeliveries)
    .set({ relayMessageId: data.messageId, relayedAt: ctx.clock.now() })
    .where(eq(webhookDeliveries.id, data.deliveryId))
    .returning({ id: webhookDeliveries.id });
  if (!row) throw new NotFoundError('Delivery');
}

/** Bot callback: the relay failed permanently. Recorded on the delivery and integration. */
export async function markRelayFailed(
  ctx: ServiceContext,
  input: z.input<typeof markRelayFailedSchema>,
): Promise<void> {
  requireSystem(ctx);
  const data = parseInput(markRelayFailedSchema, input);
  const message = `relay failed: ${cleanLine(data.reason, MAX_ERROR_LENGTH)}`.slice(
    0,
    MAX_ERROR_LENGTH,
  );
  await withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(webhookDeliveries)
      .set({ lastError: message })
      .where(eq(webhookDeliveries.id, data.deliveryId))
      .returning({ integrationId: webhookDeliveries.integrationId });
    if (!row) throw new NotFoundError('Delivery');
    await t.db
      .update(integrations)
      .set({ lastErrorAt: t.clock.now(), lastError: message })
      .where(eq(integrations.id, row.integrationId));
  });
}
