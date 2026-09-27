import { tickets } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { AutocompleteChoice, HandlerContext } from '../../interactions/types';
import { panel, row, stringSelect } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import {
  ACTION,
  AUTOCOMPLETE_LIMIT,
  AUTOCOMPLETE_SCAN_LIMIT,
  CHOICE_NAME_MAX,
  LIST_LIMIT,
  TICKETS_NS,
} from './constants';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import { SUPPORT_KICKER, ticketChoiceName, ticketInfoPanel, ticketLine } from './render';
import { findTicketByNumber, parseTicketNumber, requireHandling, ticketDigits } from './resolve';

const ACTIVE = [...tickets.ACTIVE_STATUSES];
const EVERY_STATUS = [...tickets.TICKET_STATUSES];
const SEARCH_MAX = 64;

export function moreFooter(shown: number, total: number): string | undefined {
  return total > shown
    ? `Showing ${shown} of ${total}. The full list is in the dashboard.`
    : undefined;
}

/** A select that opens one of the listed tickets (routing only; core authorizes the view). */
export function viewSelectRow(items: readonly tickets.TicketSummary[]) {
  return row(
    stringSelect(
      customId(TICKETS_NS, ACTION.view),
      'View a ticket',
      items.map((item) => ({
        value: item.id,
        label: ticketChoiceName(item, CHOICE_NAME_MAX),
        description: `${STATUS_LABELS[item.status]} ${GLYPH.dot} ${PRIORITY_LABELS[item.priority].label}`,
      })),
    ),
  );
}

/** /ticket mine — your own tickets, every status (requester view, even for staff). */
export async function showMine(h: HandlerContext): Promise<void> {
  const page = await tickets.listTickets(h.ctx, {
    mine: true,
    status: EVERY_STATUS,
    sort: 'activity',
    limit: LIST_LIMIT,
  });
  await h.respond({
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: 'Your tickets',
        description: page.items.length
          ? page.items.map((item) => ticketLine(item, false)).join('\n')
          : 'No tickets yet. Use /ticket open when you need JAVELIN staff.',
        footer: moreFooter(page.items.length, page.total),
      }),
    ],
    components: page.items.length ? [viewSelectRow(page.items)] : undefined,
    ephemeral: true,
  });
}

/**
 * /ticket queue — active tickets, most urgent deadline first, with a select to
 * claim an unassigned one. Staff only (core returns only your own otherwise).
 */
export async function showQueue(h: HandlerContext): Promise<void> {
  requireHandling(h);
  const page = await tickets.listTickets(h.ctx, { status: ACTIVE, sort: 'sla', limit: LIST_LIMIT });
  const claimable = page.items.filter((item) => !item.assignee);
  await h.respond({
    embeds: [
      panel({
        kicker: `${SUPPORT_KICKER} ${GLYPH.dot} STAFF`,
        title: 'Ticket queue',
        description: page.items.length
          ? page.items
              .map((item) => {
                const handler = item.assignee ? ` ${GLYPH.dot} <@${item.assignee.discordId}>` : '';
                return `${ticketLine(item, true)}${handler}`;
              })
              .join('\n')
          : 'Queue clear. No active tickets.',
        footer: moreFooter(page.items.length, page.total),
      }),
    ],
    components: claimable.length
      ? [
          row(
            stringSelect(
              customId(TICKETS_NS, ACTION.queueClaim),
              'Claim an unassigned ticket',
              claimable.map((item) => ({
                value: item.id,
                label: ticketChoiceName(item, CHOICE_NAME_MAX),
                description: `${PRIORITY_LABELS[item.priority].label} ${GLYPH.dot} ${item.category.toUpperCase()}`,
              })),
            ),
          ),
        ]
      : undefined,
    ephemeral: true,
  });
}

/** /ticket view — the requester or staff view of one ticket. */
export async function showTicket(h: HandlerContext, ticketId: string): Promise<void> {
  const view = await tickets.getTicket(h.ctx, { ticketId });
  await h.respond(ticketInfoPanel(view, h.ctx.config.publicUrl));
}

/**
 * Autocomplete for the `ticket` option: by number ("42", "#0042") or by
 * subject. A number finds that exact ticket in any status, then recent ones
 * whose number contains it. Core scopes every list: staff see every ticket,
 * members their own.
 */
export async function ticketChoices(
  h: HandlerContext,
  query: string,
): Promise<AutocompleteChoice[]> {
  const trimmed = query.trim();
  const digits = ticketDigits(trimmed);
  const number = parseTicketNumber(trimmed);
  const [exact, page] = await Promise.all([
    number === null ? null : findTicketByNumber(h, number),
    tickets.listTickets(h.ctx, {
      sort: 'activity',
      limit: digits !== null || !trimmed ? AUTOCOMPLETE_SCAN_LIMIT : AUTOCOMPLETE_LIMIT,
      ...(trimmed && digits === null ? { search: trimmed.slice(0, SEARCH_MAX) } : {}),
    }),
  ]);
  const matches = page.items.filter(
    (item) => digits === null || item.reference.slice(1).includes(digits),
  );
  const items = exact ? [exact, ...matches.filter((item) => item.id !== exact.id)] : matches;
  return items
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((item) => ({ name: ticketChoiceName(item, CHOICE_NAME_MAX), value: item.id }));
}
