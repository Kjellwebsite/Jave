import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { moderation, NotFoundError, upsertDiscordUser, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext, TargetMessage } from '../../interactions/types';
import { success } from '../../ui/components';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { beginAction, FIELD } from './actions';
import { displayNameOf, ensureKnownUser, pending, systemContext } from './context';
import { MOD_ACTIONS, modId } from './ids';
import { showHistory } from './commands';

/** Attachment names appended to a reported message's text, at most this many. */
const MAX_LISTED_ATTACHMENTS = 5;

/** The text a moderator or reporter saw: content, embed text and attachment names. */
export function messageText(message: TargetMessage): string {
  const parts = [message.content, ...message.embedsText];
  if (message.attachments.length > 0) {
    const names = message.attachments.slice(0, MAX_LISTED_ATTACHMENTS).map((a) => a.name);
    parts.push(`[attachments: ${names.join(', ')}]`);
  }
  return clip(parts.filter(Boolean).join('\n'), moderation.MAX_MESSAGE_INPUT);
}

function requireTargetMessage(h: HandlerContext): TargetMessage {
  const message = h.interaction.targetMessage;
  if (!message) throw new NotFoundError('Message');
  if (!message.guildId || message.guildId !== h.services.discord.guildId) {
    throw new ValidationError('This works on messages inside JAVELIN only.');
  }
  return message;
}

/** Right-click member → Apps → Moderation history (staff). */
export const historyContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Moderation history')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  requires: 'canModerate',
  help: { category: 'staff', summary: 'Right-click a member → Apps → record and actions.' },
  defer: 'ephemeral',
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    await showHistory(h, target);
  },
};

/** Right-click member → Apps → Quarantine (canQuarantine). */
export const quarantineContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Quarantine')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  requires: 'canQuarantine',
  help: { category: 'staff', summary: 'Right-click a member → Apps → restrict pending review.' },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    await ensureKnownUser(h.services, target);
    await beginAction(h, 'quarantine', { discordId: target.id, name: displayNameOf(target) }, {});
  },
};

/** Right-click message → Apps → Report message (any member). */
export const reportContextCommand: CommandDefinition = {
  kind: 'message_context',
  data: new ContextMenuCommandBuilder()
    .setName('Report message')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  help: { category: 'community', summary: 'Right-click a message → Apps → send it to staff.' },
  defer: 'ephemeral',
  async execute(h) {
    const message = requireTargetMessage(h);
    if (message.author.id === h.interaction.user.id) {
      throw new ValidationError('You cannot report your own message.');
    }
    // Identity sync of the author, from Discord's resolved message (not user input).
    await upsertDiscordUser(systemContext(h.services, 'moderation:report-author'), {
      discordId: message.author.id,
      username: message.author.username.slice(0, 64) || message.author.id,
      displayName: message.author.globalName?.slice(0, 64) ?? null,
      avatarHash: message.author.avatar,
      isBot: message.author.bot,
    });
    await moderation.reportMessage(h.ctx, {
      authorDiscordId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      content: messageText(message),
    });
    // The same reply whether or not someone reported it first: reports stay confidential.
    await h.respond({
      embeds: [
        success(
          'Report received',
          'Staff will review this message. Your report is confidential and the author is not told who filed it.',
        ),
      ],
      ephemeral: true,
    });
  },
};

/** Right-click message → Apps → Delete & warn (canModerate). */
export const deleteWarnContextCommand: CommandDefinition = {
  kind: 'message_context',
  data: new ContextMenuCommandBuilder()
    .setName('Delete & warn')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  requires: 'canModerate',
  help: {
    category: 'staff',
    summary: 'Right-click a message → Apps → remove it and warn the author.',
  },
  async execute(h) {
    const message = requireTargetMessage(h);
    if (message.author.id === h.interaction.user.id) {
      throw new ValidationError('You cannot take moderation action on yourself.');
    }
    await ensureKnownUser(h.services, message.author);
    const authorName = displayNameOf(message.author);
    const token = pending(h).put({
      kind: 'delete_warn',
      issuerDiscordId: h.interaction.user.id,
      channelId: message.channelId,
      messageId: message.id,
      authorDiscordId: message.author.id,
      authorName,
      content: messageText(message),
    });
    const modal = new ModalBuilder()
      .setCustomId(modId(MOD_ACTIONS.deleteWarnSubmit, token))
      .setTitle(clip(`DELETE & WARN — ${authorName}`, LIMITS.modalTitle))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          'The message is deleted and the author warned by DM. A private note keeps an excerpt as evidence.',
        ),
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Reason')
          .setDescription('Shown to the member with the warning.')
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
    await h.interaction.showModal(modal);
  },
};
