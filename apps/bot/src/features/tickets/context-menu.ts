import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { findUserByDiscordId, NotFoundError, tickets } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import { panel } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { LIST_LIMIT } from './constants';
import { moreFooter, viewSelectRow } from './lists';
import { SUPPORT_KICKER, ticketLine } from './render';
import { requireHandling } from './resolve';

/** Context-menu names are what members see under Apps; Discord allows mixed case and spaces. */
export const MEMBER_TICKETS_MENU = 'Member tickets';

/**
 * Right-click a member → Apps → Member tickets. Staff only: every ticket the
 * member opened, newest activity first, with a select to open one. Core
 * scopes the list (the opener filter is handler-only) and every view.
 */
export const memberTicketsMenu: CommandDefinition = {
  kind: 'user_context',
  data: new ContextMenuCommandBuilder()
    .setName(MEMBER_TICKETS_MENU)
    .setType(ApplicationCommandType.User)
    .toJSON(),
  requires: 'canHandleTickets',
  help: {
    category: 'staff',
    summary: 'Right-click a member → Apps → Member tickets: their support history.',
  },
  async execute(h) {
    requireHandling(h);
    const target = h.interaction.targetUser;
    if (!target) throw new NotFoundError('Member');
    const user = await findUserByDiscordId(h.ctx, target.id);
    const page = user
      ? await tickets.listTickets(h.ctx, {
          openerUserId: user.id,
          sort: 'activity',
          limit: LIST_LIMIT,
        })
      : null;
    const items = page?.items ?? [];
    await h.respond({
      embeds: [
        panel({
          kicker: `${SUPPORT_KICKER} ${GLYPH.dot} STAFF`,
          title: 'Member tickets',
          // Mentions inside embeds render the member but never notify anyone.
          description: [
            `<@${target.id}>`,
            '',
            ...(items.length
              ? items.map((item) => ticketLine(item, true))
              : ['No tickets from this member.']),
          ].join('\n'),
          footer: page ? moreFooter(items.length, page.total) : undefined,
        }),
      ],
      components: items.length ? [viewSelectRow(items)] : undefined,
      ephemeral: true,
    });
  },
};
