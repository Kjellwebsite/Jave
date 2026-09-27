import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { findMemberByDiscordId, NotFoundError, verification } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import { renderMemberVerifications } from './views';

/** Verifications listed by the context menu (the select holds 25). */
const MEMBER_LIMIT = 10;

/**
 * Right-click a member → Apps → Verifications. Verifiers only: the command
 * is gated on canVerifyMembers, and listVerifications refuses (and audits)
 * anyone else asking about another member.
 */
export const memberVerificationsMenu: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName('Verifications')
    .setType(ApplicationCommandType.User)
    .toJSON(),
  help: {
    category: 'staff',
    summary: 'Right-click a member → Apps → Verifications: their verification record.',
  },
  requires: 'canVerifyMembers',
  async execute(h) {
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    const member = await findMemberByDiscordId(h.ctx, target.id);
    if (!member) throw new NotFoundError('JVLN profile');
    const page = await verification.listVerifications(h.ctx, {
      subjectMemberId: member.id,
      limit: MEMBER_LIMIT,
      sort: 'newest',
    });
    await h.respond(renderMemberVerifications(member, page.items, page.total));
  },
};
