import { ApplicationCommandType, ContextMenuCommandBuilder, SlashCommandBuilder } from 'discord.js';
import { can, findMemberByDiscordId, invites, isSelf, NotFoundError } from '@jave/core';
import type {
  CommandDefinition,
  ComponentHandler,
  HandlerContext,
  ModalHandler,
} from '../../interactions/types';
import { failure } from '../../ui/components';
import {
  attachInvite,
  createCampaignFromModal,
  detachInvite,
  openCampaignModal,
  parseCampaignId,
  setCampaignActive,
  showAttachStart,
  showCampaign,
  showCampaignList,
  showInvitePicker,
} from './campaigns';
import {
  claimCode,
  claimModal,
  createCode,
  deactivateCode,
  showCodes,
  showLeaderboard,
  showMine,
} from './member-flows';
import {
  INVITES_NS,
  isLeaderboardPeriod,
  LEADERBOARD_PERIODS,
  type LeaderboardPeriod,
  renderMemberFunnel,
} from './views';

const PERIOD_CHOICES: { name: string; value: LeaderboardPeriod }[] = [
  { name: 'All time', value: 'all' },
  { name: 'Last 90 days', value: '90' },
  { name: 'Last 30 days', value: '30' },
  { name: 'Last 7 days', value: '7' },
];

export const invitesCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Referrals: your funnel, your code, the leaderboard.')
    .addSubcommand((s) =>
      s.setName('mine').setDescription('Your referral funnel: invited, joined, retained, valid.'),
    )
    .addSubcommand((s) =>
      s.setName('code').setDescription('Create, view or enter a referral code.'),
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Members with the most VALID referrals.')
        .addStringOption((o) =>
          o
            .setName('period')
            .setDescription('Validated within (default: all time)')
            .addChoices(...PERIOD_CHOICES),
        )
        .addBooleanOption((o) => o.setName('share').setDescription('Post visibly in this channel')),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('campaign')
        .setDescription('Staff: referral campaigns.')
        .addSubcommand((s) => s.setName('create').setDescription('Staff: create a campaign.'))
        .addSubcommand((s) =>
          s.setName('list').setDescription('Staff: campaigns and their funnels.'),
        )
        .addSubcommand((s) =>
          s.setName('attach').setDescription('Staff: attach a Discord invite to a campaign.'),
        ),
    )
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Referral funnel, personal code and VALID-only leaderboard. Staff: campaigns.',
    usage: '/invites mine | code | leaderboard | campaign create|list|attach',
  },

  async execute(h) {
    const group = h.interaction.options.subcommandGroup();
    const sub = h.interaction.options.subcommand();
    if (group === 'campaign') {
      if (sub === 'create') return openCampaignModal(h);
      if (sub === 'list') return showCampaignList(h, 'reply');
      if (sub === 'attach') return showAttachStart(h);
    }
    if (sub === 'mine') return showMine(h, 'reply');
    if (sub === 'code') return showCodes(h, 'reply');
    if (sub === 'leaderboard') {
      const requested = h.interaction.options.string('period') ?? 'all';
      const period = isLeaderboardPeriod(requested) ? requested : LEADERBOARD_PERIODS[0];
      const share = h.interaction.options.boolean('share') ?? false;
      return showLeaderboard(h, period, { mode: 'reply', ephemeral: !share });
    }
    await h.respond({
      embeds: [failure('UNKNOWN COMMAND', 'This subcommand is not available.')],
      ephemeral: true,
    });
  },
};

/** Right-click a member → Apps → Referral Funnel (yourself, or staff with canViewAnalytics). */
export const referralFunnelContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Referral Funnel')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Right-click a member → Apps → Referral Funnel. Yours, or anyone for analytics staff.',
  },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    const member = await findMemberByDiscordId(h.ctx, target.id);
    if (!member) throw new NotFoundError('JVLN profile');
    const funnel = await invites.getReferralFunnel(h.ctx, { inviterMemberId: member.id });
    const staffView = can(h.ctx, 'canViewAnalytics') && !isSelf(h.ctx.actor, member.id);
    await h.respond(renderMemberFunnel(member.displayName, funnel, { staffView }));
  },
};

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

/**
 * Buttons and selects. Custom ids route; they never authorize: every action
 * calls core as the clicking user, which re-checks ownership and capability.
 */
export const invitesComponents: ComponentHandler = {
  namespace: INVITES_NS,
  async handle(h, action, args) {
    switch (action) {
      case 'mine':
        return showMine(h, 'update');
      case 'codes':
        return showCodes(h, 'update');
      case 'code-new':
        return createCode(h);
      case 'code-off':
        return deactivateCode(h);
      case 'claim':
        return h.interaction.showModal(claimModal());
      case 'board': {
        const period = isLeaderboardPeriod(args[0]) ? args[0] : LEADERBOARD_PERIODS[0];
        return showLeaderboard(h, period, { mode: 'update', ephemeral: true });
      }
      case 'board-period': {
        const [value] = h.interaction.values;
        if (!isLeaderboardPeriod(value)) return expired(h);
        return showLeaderboard(h, value, { mode: 'update', ephemeral: true });
      }
      case 'camp-list':
        return showCampaignList(h, 'update');
      case 'camp-new':
        return openCampaignModal(h);
      case 'camp-view':
        return showCampaign(h, parseCampaignId(h.interaction.values[0]), 'update');
      case 'camp-view-id':
        return showCampaign(h, parseCampaignId(args[0]), 'update');
      case 'camp-attach':
        return showInvitePicker(h, parseCampaignId(h.interaction.values[0]), '0', 'update');
      case 'camp-active':
        return setCampaignActive(h, parseCampaignId(args[0]), args[1]);
      case 'inv-page':
        return showInvitePicker(h, parseCampaignId(args[0]), args[1], 'update');
      case 'inv-pick':
        return attachInvite(h, parseCampaignId(args[0]));
      case 'inv-detach':
        return detachInvite(h, parseCampaignId(args[0]));
      default:
        return expired(h);
    }
  },
};

export const invitesModals: ModalHandler = {
  namespace: INVITES_NS,
  async handle(h, action) {
    if (action === 'claim') return claimCode(h);
    if (action === 'camp-create') return createCampaignFromModal(h);
    return expired(h);
  },
};
