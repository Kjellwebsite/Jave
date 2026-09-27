import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { NotFoundError, requireMember } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { CommandDefinition } from '../../interactions/types';
import { failure, panel, row, stringSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import {
  CONTRIBUTION_TITLE_MAX,
  CONTRIBUTION_TITLE_MIN,
  LINE_TEXT_MAX,
  PROJECTS_NS,
} from './constants';
import { manageableProjects, memberIdOf } from './lookup';
import { contributionModal } from './modals';
import { projectOptions } from './render';

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

/**
 * Right-click a member → Apps → Add to Project. Step 1 of 3: pick one of the
 * projects you manage that they are not on yet (then a role, then core adds
 * them — and re-authorizes the clicking user at every step).
 */
export const addToProjectCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Add to Project')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'operations',
    summary: 'Right-click a member → Apps → add them to a project you manage.',
  },
  defer: 'ephemeral',
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target || target.bot) throw new NotFoundError('JVLN profile');
    const memberId = await memberIdOf(h, target);
    const name = userText(target.globalName ?? target.username, LINE_TEXT_MAX);
    const candidates = (await manageableProjects(h)).filter(
      (detail) => !detail.members.some((member) => member.memberId === memberId),
    );
    if (candidates.length === 0) {
      return h.respond({
        embeds: [
          failure(
            'NO PROJECT TO ADD TO',
            `You manage no active project that ${name} is not already on. Start one with \`/project create\`.`,
          ),
        ],
        ephemeral: true,
      });
    }
    await h.respond({
      embeds: [
        panel({
          kicker: 'ADD TO PROJECT',
          title: name,
          description: `Choose the project ${name} joins. They are notified and can leave at any time.`,
        }),
      ],
      components: [
        row(
          stringSelect(
            customId(PROJECTS_NS, 'addto', memberId),
            'Project…',
            projectOptions(candidates),
          ),
        ),
      ],
      ephemeral: true,
    });
  },
};
