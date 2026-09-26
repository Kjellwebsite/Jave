import { type APIUserSelectComponent, ComponentType } from 'discord.js';
import { findUserByDiscordId, tickets, ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { panel, row, stringSelect, success } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import { isPriority, PRIORITY_LABELS, priorityOptions, STATUS_LABELS } from './labels';
import { noteModal, type ReasonAction, reasonModal } from './modals';
import { SUPPORT_KICKER } from './render';
import { requireHandling } from './resolve';

/**
 * Per-ticket actions shared by slash subcommands, card buttons, selects and
 * modals. Each one calls core as the clicking user; core decides.
 */

function done(h: HandlerContext, title: string, description: string): Promise<void> {
  return h.respond({ embeds: [success(title, description)], ephemeral: true });
}

export async function claim(h: HandlerContext, ticketId: string): Promise<void> {
  const ticket = await tickets.claimTicket(h.ctx, { ticketId });
  await done(
    h,
    `Claimed ${ticket.reference}`,
    'You now handle this ticket. The requester is notified.',
  );
}

export async function unclaim(h: HandlerContext, ticketId: string): Promise<void> {
  const ticket = await tickets.unclaimTicket(h.ctx, { ticketId });
  await done(h, `Released ${ticket.reference}`, 'The ticket is back in the queue, unassigned.');
}

export async function resume(h: HandlerContext, ticketId: string): Promise<void> {
  const ticket = await tickets.resumeTicket(h.ctx, { ticketId });
  await done(
    h,
    `Resumed ${ticket.reference}`,
    `Status ${GLYPH.dot} ${STATUS_LABELS[ticket.status]}.`,
  );
}

function userSelect(custom: string, placeholder: string): APIUserSelectComponent {
  return {
    type: ComponentType.UserSelect,
    custom_id: custom,
    placeholder,
    min_values: 1,
    max_values: 1,
  };
}

/** Step 1 of a transfer: pick the new handler with Discord's member picker. */
export async function promptTransfer(h: HandlerContext, ticketId: string): Promise<void> {
  requireHandling(h);
  const card = await tickets.getTicketCard(h.ctx, { ticketId });
  await h.respond({
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: `Transfer ${card.reference}`,
        description: 'Choose the new handler. They must be able to handle tickets.',
      }),
    ],
    components: [
      row(userSelect(customId(TICKETS_NS, ACTION.transfer, ticketId), 'Choose the new handler')),
    ],
    ephemeral: true,
  });
}

/** Step 2: the chosen Discord member → their JAVE identity → core transfer. */
export async function transferTo(
  h: HandlerContext,
  ticketId: string,
  discordUserId: string | undefined,
): Promise<void> {
  if (!discordUserId) throw new ValidationError('Choose the new handler.');
  const target = await findUserByDiscordId(h.ctx, discordUserId);
  if (!target) throw new ValidationError('That member has no JAVE identity yet.');
  const ticket = await tickets.transferTicket(h.ctx, { ticketId, toUserId: target.id });
  await done(
    h,
    `Transferred ${ticket.reference}`,
    `<@${discordUserId}> now handles this ticket and is notified.`,
  );
}

export async function promptPriority(h: HandlerContext, ticketId: string): Promise<void> {
  requireHandling(h);
  const card = await tickets.getTicketCard(h.ctx, { ticketId });
  await h.respond({
    embeds: [
      panel({
        kicker: SUPPORT_KICKER,
        title: `Priority ${card.reference}`,
        description: `Current ${GLYPH.dot} ${PRIORITY_LABELS[card.priority].label}. Raising to HIGH or URGENT alerts staff.`,
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(TICKETS_NS, ACTION.priority, ticketId),
          'Choose a priority',
          priorityOptions(card.priority),
        ),
      ),
    ],
    ephemeral: true,
  });
}

export async function applyPriority(
  h: HandlerContext,
  ticketId: string,
  value: string | undefined,
): Promise<void> {
  if (!isPriority(value)) throw new ValidationError('Choose a priority from the list.');
  const ticket = await tickets.setPriority(h.ctx, { ticketId, priority: value });
  await done(
    h,
    `Priority set ${ticket.reference}`,
    `${PRIORITY_LABELS[ticket.priority].label}. The first-response target follows it while unanswered.`,
  );
}

/**
 * Close and reopen are open to the requester too, so the form is gated on
 * visibility (core's card read); waiting is a handler action.
 */
export async function promptReason(
  h: HandlerContext,
  action: ReasonAction,
  ticketId: string,
): Promise<void> {
  if (action === ACTION.waiting) requireHandling(h);
  const card = await tickets.getTicketCard(h.ctx, { ticketId });
  await h.interaction.showModal(reasonModal(action, ticketId, card.reference));
}

export async function submitReason(
  h: HandlerContext,
  action: ReasonAction,
  ticketId: string,
): Promise<void> {
  const reason = h.interaction.modal.text(FIELD.reason);
  switch (action) {
    case ACTION.close: {
      const ticket = await tickets.closeTicket(h.ctx, { ticketId, reason });
      return done(
        h,
        `Closed ${ticket.reference}`,
        'The thread is locked and archived. Reopen it any time.',
      );
    }
    case ACTION.reopen: {
      const ticket = await tickets.reopenTicket(h.ctx, { ticketId, reason });
      return done(
        h,
        `Reopened ${ticket.reference}`,
        `Status ${GLYPH.dot} ${STATUS_LABELS[ticket.status]}. The thread is open again.`,
      );
    }
    case ACTION.waiting: {
      const ticket = await tickets.setWaiting(h.ctx, { ticketId, reason });
      return done(
        h,
        `Waiting on requester ${ticket.reference}`,
        'Posted in the thread. Their next reply resumes the ticket.',
      );
    }
  }
}

export async function promptNote(h: HandlerContext, ticketId: string): Promise<void> {
  requireHandling(h);
  const card = await tickets.getTicketCard(h.ctx, { ticketId });
  await h.interaction.showModal(noteModal(ticketId, card.reference));
}

export async function submitNote(h: HandlerContext, ticketId: string): Promise<void> {
  await tickets.addInternalNote(h.ctx, { ticketId, body: h.interaction.modal.text(FIELD.note) });
  await done(h, 'Internal note added', 'Staff only. It is not posted to the thread.');
}
