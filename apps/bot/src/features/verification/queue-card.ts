import { RESTJSONErrorCodes } from 'discord.js';
import { type JobHandler, PermanentJobError, verification } from '@jave/core';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import type { BotServices } from '../../runtime';
import { button, field, linkButton, panel, row } from '../../ui/components';
import { dashboardLink } from '../applications/dashboard-link';
import { discordTime, userText } from '../../ui/format';
import { ACTIONS, verificationId } from './ids';
import { OPENED_BY_LABELS, STATUS_COLORS } from './labels';
import { dashboardVerificationPath, subjectLine, targetLine } from './views';

type QueueCard = verification.QueueCard;

const CLAIM_CHARS = 500;
const NAME_CHARS = 80;
/** Nonce prefix: "vc" + job id + "r" + render index stays within Discord's 25 characters. */
const QUEUE_CARD_NONCE_PREFIX = 'vc';

/**
 * The staff queue card (`discord.verification.queue_card`). Claim, target
 * label and names are user-provided and escaped. Evidence URLs and decision
 * notes never appear here — they stay in the private views.
 */
export function renderQueueCard(card: QueueCard, publicUrl: string | undefined): MessagePayload {
  const open = verification.isOpen(card.status);
  const fields = [
    field('Status', card.statusLabel, true),
    field(
      'Subject',
      subjectLine({ displayName: card.subject.displayName, handle: card.subject.handle }),
      true,
    ),
    field('Opened by', OPENED_BY_LABELS[card.openedBy], true),
    field('Target', targetLine(card)),
    field('Evidence', `${card.evidenceCount} item${card.evidenceCount === 1 ? '' : 's'}`, true),
    field('Requested', discordTime(card.requestedAt, 'f'), true),
  ];
  if (open && card.expiresAt) fields.push(field('Expires', discordTime(card.expiresAt), true));
  if (card.decidedAt) fields.push(field('Decided', discordTime(card.decidedAt, 'f'), true));
  fields.push(
    field(
      'Verifier',
      card.assignedVerifierName ? userText(card.assignedVerifierName, NAME_CHARS) : 'Unassigned',
      true,
    ),
  );
  const actions = open
    ? [
        ...(card.status === 'pending'
          ? [button('Start review', verificationId(ACTIONS.claim, card.verificationId), 'primary')]
          : []),
        button('Approve', verificationId(ACTIONS.approve, card.verificationId), 'success'),
        button('Reject', verificationId(ACTIONS.reject, card.verificationId), 'danger'),
      ]
    : [];
  const url = dashboardLink(publicUrl, dashboardVerificationPath(card.verificationId));
  return {
    embeds: [
      panel({
        kicker: 'VERIFICATION QUEUE',
        title: `${card.reference} — ${card.typeLabel}`,
        description: userText(card.claim, CLAIM_CHARS),
        color: STATUS_COLORS[card.status],
        fields,
      }),
    ],
    components: [
      ...(actions.length ? [row(...actions)] : []),
      row(
        button('Details', verificationId(ACTIONS.open, card.verificationId)),
        ...(url ? [linkButton('Open in dashboard', url)] : []),
      ),
    ],
  };
}

const GONE_CODES: ReadonlySet<number | string | null> = new Set([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
]);

/** The recorded card no longer exists: its message or its whole channel was deleted. */
function isGone(error: unknown): boolean {
  return error instanceof DiscordActionError && GONE_CODES.has(error.code);
}

function asJobError(error: unknown): unknown {
  return error instanceof DiscordActionError && error.permanent
    ? new PermanentJobError(error.message)
    : error;
}

/**
 * `discord.verification.queue_card` — keeps exactly one fresh card per
 * verification: render, edit or post, then report through core's
 * compare-and-set; loop while another run won the race or the card went
 * stale, at most QUEUE_CARD_MAX_RENDERS times, then retry later. A card
 * whose message or channel was deleted is reposted in the configured queue
 * channel, and core records where it now lives.
 */
export function queueCardJobHandler(services: BotServices): JobHandler {
  return async (ctx, payload, job) => {
    const parsed = verification.queueCardJobPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new PermanentJobError('invalid queue card payload');
    const { verificationId: id } = parsed.data;
    for (let render = 0; render < verification.QUEUE_CARD_MAX_RENDERS; render++) {
      const card = await verification.getQueueCard(ctx, id);
      if (!card.channelId) return { skipped: 'no queue channel' };
      const message = renderQueueCard(card, ctx.config.publicUrl);
      let shown: { channelId: string; messageId: string } | null = null;
      let posted = false;
      try {
        if (card.messageId) {
          try {
            await services.gateway.editMessage(card.channelId, card.messageId, message);
            shown = { channelId: card.channelId, messageId: card.messageId };
          } catch (error) {
            if (!isGone(error)) throw error;
          }
        }
        if (!shown) {
          // A lost card goes to the queue channel configured now; with none, cards are off.
          const channelId = card.messageId ? card.configuredChannelId : card.channelId;
          if (!channelId) return { skipped: 'no queue channel' };
          const sent = await services.gateway.sendMessageOnce(
            channelId,
            message,
            `${QUEUE_CARD_NONCE_PREFIX}${job.id}r${render}`,
          );
          shown = { channelId: sent.channelId, messageId: sent.messageId };
          posted = true;
        }
      } catch (error) {
        throw asJobError(error);
      }
      const { channelId, messageId } = shown;
      const report = await verification.markQueueCardPosted(ctx, {
        verificationId: id,
        channelId,
        messageId,
        previousMessageId: card.messageId,
        revision: card.revision,
      });
      if (!report.recorded && posted) {
        await services.gateway
          .deleteMessage(channelId, messageId, 'JAVE: duplicate verification card')
          .catch((error: unknown) => {
            if (!isGone(error)) throw asJobError(error);
          });
      }
      if (report.recorded && !report.stale) {
        await services.runJobsNow(ctx.effects.jobIds);
        return { messageId, renders: render + 1 };
      }
    }
    throw new Error('The verification queue card is still out of date. Retrying later.');
  };
}
