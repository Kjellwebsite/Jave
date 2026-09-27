import {
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { moderation, ValidationError } from '@jave/core';
import type { ComponentHandler, HandlerContext } from '../../interactions/types';
import { renderError } from '../../interactions/errors';
import { panel } from '../../ui/components';
import { COLORS } from '../../ui/theme';
import { actionModal, CASE_ACTIONS, executeCaseAction, FIELD, knownName } from './actions';
import { pending } from './context';
import { MOD_ACTIONS, MOD_NS, modId, snowflakeArg, tokenArg, uuidArg } from './ids';
import { caseReply, caseResultReply, historyReply } from './render';
import { expired, mayStart } from './replies';

async function reviewEvent(
  h: HandlerContext,
  eventId: string,
  status: 'acknowledged' | 'dismissed',
): Promise<void> {
  const view = await moderation.reviewSecurityEvent(h.ctx, { securityEventId: eventId, status });
  await h.respond({
    embeds: [
      panel({
        title: `${view.reference} ${status.toUpperCase()}`,
        description: 'The alert card updates for all staff.',
        color: COLORS.success,
      }),
    ],
    ephemeral: true,
  });
}

async function openSecurityQuarantine(h: HandlerContext, eventId: string): Promise<void> {
  const event = await moderation.getSecurityEvent(h.ctx, eventId);
  if (!event.user) throw new ValidationError('This event is not about a specific member.');
  if (!(await mayStart(h, 'quarantine'))) return;
  await h.interaction.showModal(
    actionModal(
      modId(MOD_ACTIONS.securityQuarantineSubmit, event.id),
      'quarantine',
      event.user.name,
      { reason: `${event.reference} — ${moderation.TRIGGER_LABELS[event.trigger]}` },
    ),
  );
}

async function openActionModal(h: HandlerContext, targetDiscordId: string): Promise<void> {
  const chosen = CASE_ACTIONS.find((action) => action === h.interaction.values[0]);
  if (!chosen) return expired(h);
  if (!(await mayStart(h, chosen))) return;
  const name = await knownName(h, targetDiscordId);
  await h.interaction.showModal(
    actionModal(modId(MOD_ACTIONS.actionSubmit, chosen, targetDiscordId), chosen, name),
  );
}

export function revokeModal(caseId: string, reference: string) {
  return new ModalBuilder()
    .setCustomId(modId(MOD_ACTIONS.revokeSubmit, caseId))
    .setTitle(`REVOKE ${reference}`)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'Strikes the case from the record. A timeout, quarantine or ban still in force is lifted.',
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription('Appeal granted, issued in error… Recorded in the audit log.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.reason)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(moderation.MIN_REASON_LENGTH)
            .setMaxLength(moderation.MAX_REASON_LENGTH)
            .setRequired(true),
        ),
    )
    .toJSON();
}

async function confirmPending(h: HandlerContext, token: string): Promise<void> {
  const found = pending(h).take(token, 'case', h.interaction.user.id);
  if (!found.ok) {
    return expired(
      h,
      found.reason === 'not_yours'
        ? 'Only the moderator who started this action can confirm it.'
        : 'This confirmation expired. Run the action again.',
    );
  }
  const { entry } = found;
  try {
    const view = await executeCaseAction(h.ctx, {
      action: entry.action,
      target: { discordId: entry.targetDiscordId, name: entry.targetName },
      reason: entry.reason,
      deleteMessageDays: entry.deleteMessageDays,
    });
    await h.interaction.update(caseResultReply(view, entry.action));
  } catch (error) {
    // Replace the confirmation with the refusal so it cannot be clicked again.
    const { payload } = renderError(error, h.ctx.logger);
    await h.interaction.update({ ...payload, components: [] });
  }
}

async function cancelPending(h: HandlerContext, token: string): Promise<void> {
  if (pending(h).discard(token, h.interaction.user.id) === 'not_yours') {
    return expired(h, 'Only the moderator who started this action can cancel it.');
  }
  await h.interaction.update({
    embeds: [panel({ title: 'CANCELLED', description: 'No action taken.', color: COLORS.steel })],
    components: [],
  });
}

/** Buttons and selects in the `moderation` namespace. Every path re-authorizes via core. */
export const moderationComponents: ComponentHandler = {
  namespace: MOD_NS,
  async handle(h, action, args) {
    switch (action) {
      case MOD_ACTIONS.securityAcknowledge:
      case MOD_ACTIONS.securityDismiss: {
        const eventId = uuidArg(args[0]);
        if (!eventId) return expired(h);
        return reviewEvent(
          h,
          eventId,
          action === MOD_ACTIONS.securityAcknowledge ? 'acknowledged' : 'dismissed',
        );
      }
      case MOD_ACTIONS.securityQuarantine: {
        const eventId = uuidArg(args[0]);
        if (!eventId) return expired(h);
        return openSecurityQuarantine(h, eventId);
      }
      case MOD_ACTIONS.takeAction: {
        const target = snowflakeArg(args[0]);
        if (!target) return expired(h);
        return openActionModal(h, target);
      }
      case MOD_ACTIONS.openCase: {
        const caseId = uuidArg(h.interaction.values[0]);
        if (!caseId) return expired(h);
        const view = await moderation.getCase(h.ctx, caseId);
        return h.respond(caseReply(view, h.ctx));
      }
      case MOD_ACTIONS.revokeCase: {
        const caseId = uuidArg(args[0]);
        if (!caseId) return expired(h);
        // Reading the case authorizes the viewer and hides cases they may not see.
        const view = await moderation.getCase(h.ctx, caseId);
        return h.interaction.showModal(revokeModal(view.id, view.reference));
      }
      case MOD_ACTIONS.memberHistory: {
        const target = snowflakeArg(args[0]);
        if (!target) return expired(h);
        const history = await moderation.getCaseHistory(h.ctx, { targetDiscordId: target });
        return h.respond(historyReply(history, h.ctx));
      }
      case MOD_ACTIONS.confirm: {
        const token = tokenArg(args[0]);
        if (!token) return expired(h);
        return confirmPending(h, token);
      }
      case MOD_ACTIONS.cancel: {
        const token = tokenArg(args[0]);
        if (!token) return expired(h);
        return cancelPending(h, token);
      }
      default:
        return expired(h);
    }
  },
};
