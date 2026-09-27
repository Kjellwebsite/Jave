import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { NotFoundError, requireMember } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import { failure } from '../../ui/components';
import { CONTRIBUTION_TITLE_MAX, CONTRIBUTION_TITLE_MIN } from './constants';
import { contributionModal } from './modals';

/** The message's first non-empty line as a contribution title; '' when too short to use. */
export function titleFromMessage(content: string): string {
  const line =
    content
      .split('\n')
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate.length > 0) ?? '';
  const title = line.slice(0, CONTRIBUTION_TITLE_MAX).trim();
  return title.length >= CONTRIBUTION_TITLE_MIN ? title : '';
}

/**
 * Right-click one of your own messages → Apps → Record Contribution: the
 * contribution modal, prefilled with the message's first line and its link
 * (a demo or write-up you already posted). Only your own messages — nobody
 * records someone else's work as theirs; core re-checks everything on submit.
 */
export const recordContributionCommand: CommandDefinition = {
  kind: 'message_context',
  data: new ContextMenuCommandBuilder()
    .setName('Record Contribution')
    .setType(ApplicationCommandType.Message)
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Right-click one of your messages → Apps → record it as a contribution.',
  },
  async execute(h) {
    const message = h.interaction.targetMessage;
    if (!message) throw new NotFoundError('Message');
    if (message.author.id !== h.interaction.user.id || message.webhookId) {
      return h.respond({
        embeds: [
          failure(
            'NOT YOUR MESSAGE',
            'Record only your own work. Right-click one of your own messages.',
          ),
        ],
        ephemeral: true,
      });
    }
    requireMember(h.ctx);
    await h.interaction.showModal(
      contributionModal(null, { title: titleFromMessage(message.content), url: message.url }),
    );
  },
};
