import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { NotFoundError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { CommandDefinition } from '../../interactions/types';
import { failure, panel, row, stringSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import { LINE_TEXT_MAX, PROJECTS_NS } from './constants';
import { manageableProjects, memberIdOf } from './lookup';
import { projectOptions } from './render';

/**
 * Right-click a member → Apps → Add to Project. Step 1 of 3: pick one of
 * the projects you manage (then a role, then core adds them).
 */
export const addToProjectCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Add to Project')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'operations',
    summary: 'Right-click a member to add them to a project you manage.',
  },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target || target.bot) throw new NotFoundError('JVLN profile');
    const memberId = await memberIdOf(h, target);
    const manageable = (await manageableProjects(h)).filter(
      (detail) => !detail.members.some((member) => member.memberId === memberId),
    );
    const name = userText(target.globalName ?? target.username, LINE_TEXT_MAX);
    if (manageable.length === 0) {
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
          description: `Choose the project ${name} joins.`,
        }),
      ],
      components: [
        row(
          stringSelect(
            customId(PROJECTS_NS, 'addto', memberId),
            'Project…',
            projectOptions(manageable),
          ),
        ),
      ],
      ephemeral: true,
    });
  },
};
