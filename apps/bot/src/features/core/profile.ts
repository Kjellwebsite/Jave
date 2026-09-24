import { ApplicationCommandType, ContextMenuCommandBuilder, SlashCommandBuilder } from 'discord.js';
import { getProfile, NotFoundError, requireUser } from '@jave/core';
import type { CommandDefinition, ComponentHandler, HandlerContext } from '../../interactions/types';
import { renderCapabilities, renderProfileCard } from '../../ui/profile';
import { failure } from '../../ui/components';

async function showProfile(h: HandlerContext, discordId: string, share: boolean) {
  const view = await getProfile(h.ctx, { discordId }).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      throw new NotFoundError('JVLN profile', { hint: 'private or not initialized' });
    }
    throw error;
  });
  // Staff-only profiles are never posted publicly, even when the viewer may see them.
  const canShare = share && view.profileVisibility !== 'staff';
  await h.respond(
    renderProfileCard(view, { publicUrl: h.ctx.config.publicUrl, ephemeral: !canShare }),
  );
}

export const profileCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a JVLN profile.')
    .addUserOption((o) => o.setName('member').setDescription('Member to view (default: you)'))
    .addBooleanOption((o) => o.setName('share').setDescription('Post visibly in this channel'))
    .toJSON(),
  help: {
    category: 'identity',
    summary: 'View a JVLN profile card.',
    usage: '/profile [member] [share]',
  },
  async execute(h) {
    const target = h.interaction.options.user('member') ?? h.interaction.user;
    await showProfile(h, target.id, h.interaction.options.boolean('share') ?? false);
  },
};

export const profileContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('JVLN Profile')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: { category: 'identity', summary: 'Right-click a member → Apps → JVLN Profile.' },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    await showProfile(h, target.id, false);
  },
};

export const profileComponents: ComponentHandler = {
  namespace: 'profile',
  async handle(h, action, args) {
    if (action === 'self') {
      await showProfile(h, h.interaction.user.id, false);
      return;
    }
    if (action === 'facets' && args[0]) {
      const view = await getProfile(h.ctx, { memberId: args[0] });
      await h.respond(renderCapabilities(view));
      return;
    }
    requireUser(h.ctx);
    await h.respond({
      embeds: [failure('EXPIRED', 'This control is no longer active.')],
      ephemeral: true,
    });
  },
};
