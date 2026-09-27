import { ApplicationCommandType, ContextMenuCommandBuilder, SlashCommandBuilder } from 'discord.js';
import {
  achievements,
  can,
  getMemberById,
  isSelf,
  NotFoundError,
  requireMember,
  ValidationError,
} from '@jave/core';
import type { CommandDefinition, HandlerContext, ReplyPayload } from '../../interactions/types';
import { heldAwards, resolveMemberId } from './data';
import { buildCatalogLines, type HolderShares, renderCatalogPanel } from './render';
import { awardFromCommand, achievementAutocomplete, revokeFromCommand } from './staff';

/** Share of active members holding each achievement, as the viewer may see it. */
async function holderShares(h: HandlerContext): Promise<HolderShares> {
  const byKey = new Map<string, number>();
  const bySlot = new Map<number, number>();
  // Rarity stats need canViewMembers; checking first keeps refusals out of the audit log.
  if (can(h.ctx, 'canViewMembers')) {
    const stats = await achievements.getAchievementRarityStats(h.ctx);
    for (const stat of stats.achievements) {
      if (stat.masked) bySlot.set(stat.slot, stat.percent);
      else byKey.set(stat.key, stat.percent);
    }
  }
  return { byKey, bySlot };
}

/**
 * The catalog seen through one member: their unlocked achievements marked,
 * the rest locked, hidden ones masked unless the member (or a staff viewer)
 * may see them. Visibility of the member is checked before anything renders.
 */
export async function memberCatalogPayload(
  h: HandlerContext,
  memberId: string,
  options: { page: number; share: boolean },
): Promise<ReplyPayload> {
  const held = await heldAwards(h, memberId);
  const [catalog, member, shares] = await Promise.all([
    achievements.getAchievementCatalog(h.ctx),
    getMemberById(h.ctx, memberId),
    holderShares(h),
  ]);
  // Staff-only profiles are never posted publicly, even when the viewer may see them.
  const shared = options.share && member.profileVisibility !== 'staff';
  const staff =
    can(h.ctx, 'canAwardAchievements') && !isSelf(h.ctx.actor, memberId)
      ? { canRevoke: held.length > 0, canVerify: held.some((award) => !award.verified) }
      : null;
  return renderCatalogPanel({
    memberId,
    memberName: member.displayName,
    lines: buildCatalogLines(catalog, held, shares),
    page: options.page,
    staff,
    shared,
  });
}

async function viewFromCommand(h: HandlerContext) {
  const target = h.interaction.options.user('member');
  const memberId = target
    ? await resolveMemberId(h, { discordId: target.id })
    : requireMember(h.ctx).memberId;
  const share = h.interaction.options.boolean('share') ?? false;
  await h.respond(await memberCatalogPayload(h, memberId, { page: 0, share }));
}

export const achievementsCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Achievement catalog: unlocked, locked and classified.')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('A member’s achievements against the catalog.')
        .addUserOption((o) => o.setName('member').setDescription('Member (default: you)'))
        .addBooleanOption((o) => o.setName('share').setDescription('Post visibly in this channel')),
    )
    .addSubcommand((s) =>
      s
        .setName('award')
        .setDescription('Staff: award an achievement by hand.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('achievement')
            .setDescription('Achievement')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Why (recorded in the audit log)')
            .setRequired(true)
            .setMinLength(achievements.REASON_MIN)
            .setMaxLength(achievements.REASON_MAX),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('revoke')
        .setDescription('Staff: revoke an award.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('achievement')
            .setDescription('Achievement')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Why (shown in the audit log)')
            .setRequired(true)
            .setMinLength(achievements.REASON_MIN)
            .setMaxLength(achievements.REASON_MAX),
        ),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Achievement catalog with your unlocks. Staff award and revoke.',
    usage: '/achievements view [member] | award | revoke',
  },
  async autocomplete(h) {
    await achievementAutocomplete(h);
  },
  async execute(h) {
    switch (h.interaction.options.subcommand()) {
      case 'view':
        return viewFromCommand(h);
      case 'award':
        return awardFromCommand(h);
      case 'revoke':
        return revokeFromCommand(h);
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};

export const achievementsContextCommand: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('JVLN Achievements')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: { category: 'progression', summary: 'Right-click a member → Apps → JVLN Achievements.' },
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    const memberId = await resolveMemberId(h, { discordId: target.id });
    await h.respond(await memberCatalogPayload(h, memberId, { page: 0, share: false }));
  },
};
