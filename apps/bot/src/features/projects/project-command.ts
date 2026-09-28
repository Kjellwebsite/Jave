import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { anonymousActor, loadCatalog, projects, ValidationError, withActor } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { notice, success } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { LINE_TEXT_MAX } from './constants';
import {
  loadProject,
  manageScope,
  memberIdOf,
  openMilestoneChoices,
  projectChoices,
  uuidArg,
} from './lookup';
import { createProjectModal, milestoneModal } from './modals';
import { editRestriction, projectListPayload, statusPickerPayload } from './project-views';
import { projectCard, ROLE_LABELS } from './render';

const PROJECT_OPTION = 'project';
const MILESTONE_OPTION = 'milestone';
const MEMBER_OPTION = 'member';
const ROLE_OPTION = 'role';
const STATUS_OPTION = 'status';

const ROLE_CHOICES = [
  { name: 'Contributor', value: 'contributor' },
  { name: 'Maintainer', value: 'maintainer' },
] as const;

type AssignableRole = (typeof ROLE_CHOICES)[number]['value'];

function assignableRole(value: string | null): AssignableRole {
  return value === 'maintainer' ? 'maintainer' : 'contributor';
}

function projectOption(description: string) {
  return (o: SlashCommandStringOption) =>
    o
      .setName(PROJECT_OPTION)
      .setDescription(description)
      .setRequired(true)
      .setAutocomplete(true)
      .setMaxLength(64);
}

const data = new SlashCommandBuilder()
  .setName('project')
  .setDescription('Projects: start, view, move through the pipeline.')
  .addSubcommand((s) =>
    s.setName('create').setDescription('Start a project. You become its owner.'),
  )
  .addSubcommand((s) =>
    s
      .setName('view')
      .setDescription('Project card: pipeline, team, milestones, links.')
      .addStringOption(projectOption('Project'))
      .addBooleanOption((o) =>
        o.setName('share').setDescription('Post visibly in this channel (public projects only)'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('Browse projects.')
      .addStringOption((o) =>
        o
          .setName(STATUS_OPTION)
          .setDescription('Only this status')
          .addChoices(
            ...projects.PROJECT_STATUSES.map((status) => ({
              name: projects.STATUS_LABELS[status],
              value: status,
            })),
          ),
      )
      .addBooleanOption((o) => o.setName('mine').setDescription('Only projects you are on')),
  )
  .addSubcommand((s) =>
    s
      .setName('status')
      .setDescription('Owners and maintainers: move the project to its next status.')
      .addStringOption(projectOption('Project you manage')),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('milestone')
      .setDescription('Project milestones.')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a milestone.')
          .addStringOption(projectOption('Project you manage')),
      )
      .addSubcommand((s) =>
        s
          .setName('done')
          .setDescription('Mark a milestone done.')
          .addStringOption(projectOption('Project you manage'))
          .addStringOption((o) =>
            o
              .setName(MILESTONE_OPTION)
              .setDescription('Open milestone')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('member')
      .setDescription('Project team.')
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Add a member to your project.')
          .addStringOption(projectOption('Project you manage'))
          .addUserOption((o) =>
            o.setName(MEMBER_OPTION).setDescription('Member to add').setRequired(true),
          )
          .addStringOption((o) =>
            o
              .setName(ROLE_OPTION)
              .setDescription('Role (default: contributor)')
              .addChoices(...ROLE_CHOICES),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove a member from your project.')
          .addStringOption(projectOption('Project you manage'))
          .addUserOption((o) =>
            o.setName(MEMBER_OPTION).setDescription('Member to remove').setRequired(true),
          ),
      ),
  )
  .toJSON();

async function execute(h: HandlerContext): Promise<void> {
  const o = h.interaction.options;
  const group = o.subcommandGroup();
  const sub = o.subcommand();
  const publicUrl = h.ctx.config.publicUrl;

  if (group === 'milestone' && sub === 'add') {
    const detail = await loadProject(h, o.string(PROJECT_OPTION));
    const restricted = editRestriction(detail);
    if (restricted) return h.respond(restricted);
    return h.interaction.showModal(milestoneModal(detail.id, detail.title));
  }
  if (group === 'milestone' && sub === 'done') {
    const detail = await loadProject(h, o.string(PROJECT_OPTION));
    // Autocomplete sends the milestone id; typed text that is not one names no milestone.
    const milestone = await projects.completeMilestone(h.ctx, {
      projectId: detail.id,
      milestoneId: uuidArg([o.string(MILESTONE_OPTION) ?? ''], 0, 'Milestone'),
    });
    return h.respond({
      embeds: [
        success(
          'Milestone done',
          `${userText(detail.title, LINE_TEXT_MAX)} ${GLYPH.dot} ${userText(milestone.title, LINE_TEXT_MAX)}`,
        ),
      ],
      ephemeral: true,
    });
  }
  if (group === 'member') {
    const detail = await loadProject(h, o.string(PROJECT_OPTION));
    const user = o.user(MEMBER_OPTION);
    if (!user) throw new ValidationError('Choose a member.');
    const memberId = await memberIdOf(h, user);
    const name = userText(user.globalName ?? user.username, LINE_TEXT_MAX);
    if (sub === 'add') {
      const role = assignableRole(o.string(ROLE_OPTION));
      await projects.addProjectMember(h.ctx, { projectId: detail.id, memberId, role });
      return h.respond({
        embeds: [
          success(
            'Member added',
            `${name} ${GLYPH.dot} ${ROLE_LABELS[role]} ${GLYPH.dot} ${userText(detail.title, LINE_TEXT_MAX)}. They were notified.`,
          ),
        ],
        ephemeral: true,
      });
    }
    await projects.removeProjectMember(h.ctx, { projectId: detail.id, memberId });
    return h.respond({
      embeds: [
        success('Member removed', `${name} ${GLYPH.dot} ${userText(detail.title, LINE_TEXT_MAX)}.`),
      ],
      ephemeral: true,
    });
  }

  switch (sub) {
    case 'create':
      return h.interaction.showModal(createProjectModal(await loadCatalog(h.ctx)));
    case 'view': {
      const detail = await loadProject(h, o.string(PROJECT_OPTION));
      if (o.boolean('share') !== true) return h.respond(projectCard(detail, { publicUrl }));
      if (detail.visibility !== 'public') {
        const card = projectCard(detail, { publicUrl });
        return h.respond({
          ...card,
          embeds: [
            notice(
              'NOT SHARED',
              'Only PUBLIC projects can be posted in a channel. Shown to you only.',
            ),
            ...(card.embeds ?? []),
          ],
        });
      }
      // Everyone in the channel reads a shared card: render what the public may
      // see (profile privacy applied by core), never the sharer's insider view.
      const audience = withActor(h.ctx, anonymousActor);
      const publicDetail = await projects.getProject(audience, { projectId: detail.id });
      return h.respond(projectCard(publicDetail, { publicUrl, shared: true }));
    }
    case 'list': {
      const status = projects.PROJECT_STATUSES.find((s) => s === o.string(STATUS_OPTION));
      const scope = o.boolean('mine') ? 'mine' : 'all';
      return h.respond(await projectListPayload(h, scope, status, 0));
    }
    case 'status':
      return h.respond(statusPickerPayload(await loadProject(h, o.string(PROJECT_OPTION))));
    default:
      throw new ValidationError('Unknown subcommand.');
  }
}

export const projectCommand: CommandDefinition = {
  kind: 'slash',
  data,
  help: {
    category: 'operations',
    summary: 'Start, view and ship projects; milestones and team.',
    usage: '/project create | view | list | status | milestone | member',
  },
  execute,
  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (!focused) return h.interaction.autocomplete([]);
    if (focused.name === MILESTONE_OPTION) {
      return h.interaction.autocomplete(
        await openMilestoneChoices(h, h.interaction.options.string(PROJECT_OPTION), focused.value),
      );
    }
    if (focused.name !== PROJECT_OPTION) return h.interaction.autocomplete([]);
    const sub = h.interaction.options.subcommand();
    const scope = sub === 'view' ? 'visible' : manageScope(h);
    return h.interaction.autocomplete(await projectChoices(h, focused.value, scope));
  },
};
