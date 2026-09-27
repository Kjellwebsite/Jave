import { RESTJSONErrorCodes } from 'discord.js';
import { moderation, redactString, truncate, ValidationError } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { HandlerContext, ModalHandler } from '../../interactions/types';
import { success } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { CASE_ACTIONS, deleteDaysFor, durationFor, FIELD, knownName, proceed } from './actions';
import { pending } from './context';
import { expired, mayStart } from './replies';
import { MOD_ACTIONS, MOD_NS, snowflakeArg, tokenArg, uuidArg } from './ids';
import { applyRaidMode, parseRaidState } from './raidmode';

function reasonFrom(h: HandlerContext): string {
  return h.interaction.modal.text(FIELD.reason).trim();
}

async function submitAction(h: HandlerContext, args: readonly string[]): Promise<void> {
  const action = CASE_ACTIONS.find((candidate) => candidate === args[0]);
  const targetDiscordId = snowflakeArg(args[1]);
  if (!action || !targetDiscordId) return expired(h);
  if (!(await mayStart(h, action))) return;
  const { modal } = h.interaction;
  const durationSeconds = durationFor(action, modal.select(FIELD.duration)[0]);
  const deleteMessageDays =
    action === 'ban' ? deleteDaysFor(modal.select(FIELD.deleteMessages)[0] ?? '0') : undefined;
  await h.interaction.defer({ ephemeral: true });
  await proceed(h, {
    action,
    target: { discordId: targetDiscordId, name: await knownName(h, targetDiscordId) },
    reason: reasonFrom(h),
    durationSeconds,
    deleteMessageDays,
  });
}

async function submitSecurityQuarantine(h: HandlerContext, eventId: string): Promise<void> {
  if (!(await mayStart(h, 'quarantine'))) return;
  // Re-read as the submitting user: authorizes, and resolves the subject server-side.
  const event = await moderation.getSecurityEvent(h.ctx, eventId);
  if (!event.user) throw new ValidationError('This event is not about a specific member.');
  const durationSeconds = durationFor('quarantine', h.interaction.modal.select(FIELD.duration)[0]);
  await h.interaction.defer({ ephemeral: true });
  await proceed(h, {
    action: 'quarantine',
    target: { discordId: event.user.discordId, name: event.user.name },
    reason: reasonFrom(h),
    durationSeconds,
    securityEventId: event.id,
  });
}

async function submitRevoke(h: HandlerContext, caseId: string): Promise<void> {
  await h.interaction.defer({ ephemeral: true });
  const result = await moderation.revokeCase(h.ctx, { caseId, reason: reasonFrom(h) });
  await h.respond({
    embeds: [
      success(
        `${result.case.reference} revoked`,
        result.reversal
          ? `Lifted through ${result.reversal.reference}. Discord applies it within seconds.`
          : 'Struck from the record.',
      ),
    ],
    ephemeral: true,
  });
}

/** Delete a message; "Unknown Message" means it is already gone. */
async function deleteMessage(
  h: HandlerContext,
  channelId: string,
  messageId: string,
  reason: string,
): Promise<string | null> {
  try {
    await h.services.gateway.deleteMessage(channelId, messageId, reason);
    return null;
  } catch (error) {
    if (error instanceof DiscordActionError) {
      return error.code === RESTJSONErrorCodes.UnknownMessage ? null : error.message;
    }
    throw error;
  }
}

async function submitDeleteWarn(h: HandlerContext, token: string): Promise<void> {
  const found = pending(h).take(token, 'delete_warn', h.interaction.user.id);
  if (!found.ok) {
    return expired(h, 'This form expired. Right-click the message and run Delete & warn again.');
  }
  const { entry } = found;
  await h.interaction.defer({ ephemeral: true });
  // The warning authorizes the whole action (capability + hierarchy) before anything is deleted.
  const warning = await moderation.warnMember(h.ctx, {
    targetDiscordId: entry.authorDiscordId,
    reason: reasonFrom(h),
  });
  const excerpt = truncate(redactString(entry.content), moderation.EVIDENCE_EXCERPT_MAX);
  const note = await moderation.addModNote(h.ctx, {
    targetDiscordId: entry.authorDiscordId,
    reason: truncate(
      `Evidence for ${warning.reference}: deleted message ${entry.messageId} in channel ${entry.channelId}: “${excerpt}”`,
      moderation.MAX_REASON_LENGTH,
    ),
  });
  const deleteError = await deleteMessage(
    h,
    entry.channelId,
    entry.messageId,
    moderation.auditReasonFor(warning.number, warning.reason),
  );
  const lines = [
    `${userText(entry.authorName, 80)} ${GLYPH.dot} <@${entry.authorDiscordId}>`,
    deleteError
      ? `The message could not be deleted: ${userText(deleteError, 300)}`
      : 'Message deleted.',
    `Excerpt kept on ${note.reference} (staff only).`,
  ];
  await h.respond({
    embeds: [success(`WARNING ISSUED — ${warning.reference}`, lines.join('\n'))],
    ephemeral: true,
  });
}

/** Modal submissions in the `moderation` namespace. */
export const moderationModals: ModalHandler = {
  namespace: MOD_NS,
  async handle(h, action, args) {
    switch (action) {
      case MOD_ACTIONS.actionSubmit:
        return submitAction(h, args);
      case MOD_ACTIONS.securityQuarantineSubmit: {
        const eventId = uuidArg(args[0]);
        if (!eventId) return expired(h);
        return submitSecurityQuarantine(h, eventId);
      }
      case MOD_ACTIONS.revokeSubmit: {
        const caseId = uuidArg(args[0]);
        if (!caseId) return expired(h);
        return submitRevoke(h, caseId);
      }
      case MOD_ACTIONS.deleteWarnSubmit: {
        const token = tokenArg(args[0]);
        if (!token) return expired(h);
        return submitDeleteWarn(h, token);
      }
      case MOD_ACTIONS.raidModeSubmit: {
        const state = parseRaidState(args[0]);
        if (!state) return expired(h);
        await h.interaction.defer({ ephemeral: true });
        return applyRaidMode(h, state, reasonFrom(h));
      }
      default:
        return expired(h);
    }
  },
};
