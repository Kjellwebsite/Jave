import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { findUserByDiscordId, NotFoundError, tickets } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import { linkButton, panel, row } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { LIST_LIMIT } from './constants';
import { moreFooter, viewSelectRow } from './lists';
import { dashboardUrl, SUPPORT_KICKER, ticketLine } from './render';
import { requireHandling } from './resolve';

/** Context-menu names are what members see under Apps; Discord allows mixed case and spaces. */
export const MEMBER_TICKETS_MENU = 'Member tickets';

const EVERY_STATUS = [...tickets.TICKET_STATUSES];

/**
 * Right-click a member → Apps → Member tickets. Staff only: every ticket the
 * member opened (archived included), newest activity first, with a select to
 * view one and a link to the full history in the dashboard queue. Core
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
          status: EVERY_STATUS,
          sort: 'activity',
          limit: LIST_LIMIT,
        })
      : null;
    const items = page?.items ?? [];
    const history =
      user && items.length
        ? dashboardUrl(h.ctx.config.publicUrl, '/tickets', { opener: user.id, status: 'all' })
        : null;
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
      components: items.length
        ? [viewSelectRow(items), ...(history ? [row(linkButton('Full history', history))] : [])]
        : undefined,
      ephemeral: true,
    });
  },
};
