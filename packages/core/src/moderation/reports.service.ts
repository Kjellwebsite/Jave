import { z } from 'zod';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { requireUser } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { MAX_MESSAGE_INPUT } from './automod.service';
import { MESSAGE_REPORT_LIMIT, MESSAGE_REPORT_WINDOW_SECONDS } from './constants';
import { buildEvidence, createSecurityEvent } from './security.service';
import { deny, loadTarget } from './targets';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

/** A member report carries no automated assessment: staff judge it. */
export const MESSAGE_REPORT_RISK_SCORE = 0;

export const reportMessageSchema = z.object({
  /** The message author. The surface must have synced this Discord user. */
  authorDiscordId: snowflake,
  channelId: snowflake,
  messageId: snowflake,
  /** The message text as Discord delivered it (stored redacted and truncated). */
  content: z.string().max(MAX_MESSAGE_INPUT).default(''),
});

export interface MessageReportResult {
  securityEventId: string;
  /** Someone already reported this message; no new alert was raised. */
  duplicate: boolean;
}

/**
 * Report a message to staff (any signed-in user in good standing): records a
 * `manual_report` security event with the excerpt as evidence, which alerts
 * `canViewSecurityEvents` holders and posts the alert card. One event per
 * message — later reports of the same message are acknowledged without a new
 * alert — and each reporter is rate limited, so reports cannot flood staff.
 * The dedupe namespace (`report:`) never collides with automated detections.
 */
export async function reportMessage(
  ctx: ServiceContext,
  input: z.input<typeof reportMessageSchema>,
): Promise<MessageReportResult> {
  const data = parseInput(reportMessageSchema, input);
  const actor = requireUser(ctx);
  if (actor.standing === 'quarantined' || actor.standing === 'banned') {
    await deny(ctx, 'Reports are unavailable while your account is restricted.', {
      type: 'security_event',
      id: null,
    });
  }
  if (actor.discordId === data.authorDiscordId) {
    throw new ValidationError('You cannot report your own message.');
  }
  await consumeRateLimit(
    ctx,
    `moderation:report:${actor.userId}`,
    MESSAGE_REPORT_LIMIT,
    MESSAGE_REPORT_WINDOW_SECONDS,
  );
  const target = await loadTarget(ctx, { discordId: data.authorDiscordId });
  const { event, created } = await withTransaction(ctx, (tx) =>
    createSecurityEvent(tx, {
      userId: target.userId,
      trigger: 'manual_report',
      riskScore: MESSAGE_REPORT_RISK_SCORE,
      source: 'manual',
      evidence: buildEvidence({
        signals: [],
        channelId: data.channelId,
        messageIds: [data.messageId],
        excerpt: data.content,
      }),
      actionTaken: 'none',
      channelId: data.channelId,
      reportedByUserId: actor.userId,
      dedupeKey: `report:${data.messageId}`,
    }),
  );
  return { securityEventId: event.id, duplicate: !created };
}
