import type { APIButtonComponent } from 'discord.js';
import { can, ForbiddenError, InvalidStateError, requireUser, tickets } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext } from '../../interactions/types';
import { button, field, panel, row, stringSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { userSelect } from './actions';
import { ACTION, CARD_SUBJECT_MAX, TICKETS_NS } from './constants';
import {
  isActiveStatus,
  PRIORITY_LABELS,
  priorityOptions,
  STATUS_COLORS,
  STATUS_LABELS,
} from './labels';
import { SUPPORT_KICKER } from './render';

interface ManageControls {
  claim: boolean;
  release: boolean;
  transfer: boolean;
  /** Priority, waiting/resume and close: the assignment scope. */
  triage: boolean;
}

/**
 * Which controls to offer, from the access table in docs/modules/tickets.md,
 * so nobody is shown a control that always fails. Display only: core
 * authorizes every action again as the clicking user.
 */
function manageControls(h: HandlerContext, view: tickets.TicketView): ManageControls {
  const manager = can(h.ctx, 'canManageTickets');
  const mine = view.assignee?.userId === requireUser(h.ctx).userId;
  return {
    claim: !view.assignee,
    release: view.assignee !== null && (mine || manager),
    transfer: mine || manager,
    triage: !view.assignee || mine || manager,
  };
}

function actionButtons(view: tickets.TicketView, controls: ManageControls): APIButtonComponent[] {
  const id = view.id;
  const buttons: APIButtonComponent[] = [];
  if (controls.claim)
    buttons.push(button('Claim', customId(TICKETS_NS, ACTION.claim, id), 'primary'));
  if (controls.release) buttons.push(button('Release', customId(TICKETS_NS, ACTION.unclaim, id)));
  if (controls.triage) {
    buttons.push(
      view.status === 'waiting'
        ? button('Resume', customId(TICKETS_NS, ACTION.resume, id))
        : button('Wait on requester', customId(TICKETS_NS, ACTION.waiting, id)),
    );
  }
  buttons.push(
    button('Internal note', customId(TICKETS_NS, ACTION.note, id)),
    button('AI summary', customId(TICKETS_NS, ACTION.summary, id)),
  );
  if (controls.triage)
    buttons.push(button('Close', customId(TICKETS_NS, ACTION.close, id), 'danger'));
  return buttons;
}

/**
 * MANAGE — the handler actions on one ticket without typing a command: claim
 * or release, wait or resume, internal note, AI summary, close, a priority
 * select and a transfer picker. Ephemeral and staff only. Every control routes
 * to the same core call as its /ticket subcommand, made as the clicking user.
 */
export async function showManage(h: HandlerContext, ticketId: string): Promise<void> {
  if (!can(h.ctx, 'canHandleTickets')) {
    throw new ForbiddenError('MANAGE is for JAVELIN staff. Use CLOSE to close your own ticket.');
  }
  const view = await tickets.getTicket(h.ctx, { ticketId });
  if (view.viewer !== 'handler') throw new ForbiddenError('You cannot handle your own ticket.');
  if (view.status === 'archived') throw new InvalidStateError('Archived tickets are read-only.');
  if (!isActiveStatus(view.status)) {
    throw new InvalidStateError(`Ticket ${view.reference} is closed. Reopen it first.`);
  }
  const controls = manageControls(h, view);
  const rows = [row(...actionButtons(view, controls))];
  if (controls.triage) {
    rows.push(
      row(
        stringSelect(
          customId(TICKETS_NS, ACTION.priority, view.id),
          'Change the priority',
          priorityOptions(view.priority),
        ),
      ),
    );
  }
  if (controls.transfer) {
    rows.push(
      row(userSelect(customId(TICKETS_NS, ACTION.transfer, view.id), 'Transfer to a handler')),
    );
  }
  await h.respond({
    embeds: [
      panel({
        kicker: `${SUPPORT_KICKER} ${GLYPH.dot} STAFF`,
        title: `Manage ${view.reference}`,
        description: `**${userText(view.subject, CARD_SUBJECT_MAX)}**`,
        color: STATUS_COLORS[view.status],
        fields: [
          field('Status', STATUS_LABELS[view.status], true),
          field('Priority', PRIORITY_LABELS[view.priority].label, true),
          field('Handler', view.assignee ? `<@${view.assignee.discordId}>` : 'Unassigned', true),
        ],
      }),
    ],
    components: rows,
    ephemeral: true,
  });
}
