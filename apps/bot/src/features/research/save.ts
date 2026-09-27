import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { ConflictError, NotFoundError, research, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext, TargetMessage } from '../../interactions/types';
import { panel } from '../../ui/components';
import { COLORS } from '../../ui/theme';
import { cardFor } from './items';

/** Core's per-message limits (see research/constants.ts). */
const MAX_CONTENT = 4000;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_NAME = 200;
const MAX_CONTENT_TYPE = 100;
const MAX_ATTACHMENT_URL = 2048;

/**
 * The message exactly as the gateway delivered it with the interaction.
 * `saveFromMessage` trusts this binding of content to message id, which is
 * why it is only ever called from a Discord context menu.
 */
export function messageInput(target: TargetMessage): research.SaveFromMessageInput {
  return {
    content: target.content.slice(0, MAX_CONTENT),
    messageUrl: target.url,
    messageId: target.id,
    attachments: target.attachments
      .filter((attachment) => attachment.url.length <= MAX_ATTACHMENT_URL)
      .slice(0, MAX_ATTACHMENTS)
      .map((attachment) => ({
        url: attachment.url,
        filename: attachment.name.slice(0, MAX_ATTACHMENT_NAME) || 'attachment',
        contentType: attachment.contentType?.slice(0, MAX_CONTENT_TYPE) || undefined,
      })),
  };
}

const DUPLICATE_TITLE = 'DUPLICATE — ALREADY IN THE LIBRARY';

/**
 * Save and report. Core returns an existing item the member can see as a
 * duplicate, and refuses (ConflictError) when the reference exists but is
 * hidden from them (archived by someone else, or removed).
 */
async function saveReply(h: HandlerContext, target: TargetMessage) {
  let saved: research.SaveResult;
  try {
    saved = await research.saveFromMessage(h.ctx, messageInput(target));
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    return {
      embeds: [
        panel({ title: DUPLICATE_TITLE, description: error.userMessage, color: COLORS.steel }),
      ],
      ephemeral: true,
    };
  }
  if (saved.duplicate) {
    return cardFor(h, saved.item, {
      title: DUPLICATE_TITLE,
      description: 'This reference was saved before. Nothing new was created.',
    });
  }
  return cardFor(h, saved.item, {
    title: 'SAVED TO SIDUS — NEW',
    description:
      'Metadata lookup runs now (Crossref for DOIs, arXiv for arXiv IDs). A reviewer sets its status and evidence level.',
  });
}

export const saveToSidusContext: CommandDefinition = {
  kind: 'message_context',
  data: new ContextMenuCommandBuilder()
    .setName('Save to Sidus')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  help: {
    category: 'intelligence',
    summary: 'Save a paper or link from a message to the SIDUS SCIENCE library.',
  },
  requires: 'canViewMembers',
  defer: 'ephemeral',
  async execute(h) {
    const target = h.interaction.targetMessage;
    if (!target) throw new NotFoundError('Message');
    if (
      h.interaction.guildId !== h.services.discord.guildId ||
      target.guildId !== h.interaction.guildId
    ) {
      throw new ValidationError('Save messages from JAVELIN channels only.');
    }
    await h.respond(await saveReply(h, target));
  },
};
