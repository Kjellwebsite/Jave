import { ValidationError } from '@jave/core';
import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import { failure } from '../../ui/components';
import {
  applyPriority,
  claim,
  promptReason,
  submitNote,
  submitReason,
  transferTo,
} from './actions';
import { ACTION, TICKETS_NS } from './constants';
import { showTicket } from './lists';
import { showOpenForm, submitOpen } from './open';
import { ticketIdArg } from './resolve';
import { isForced, showSummary } from './summary';

const SNOWFLAKE = /^\d{17,20}$/;

function expired(h: HandlerContext): Promise<void> {
  return h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

function chosenMember(values: readonly string[]): string {
  const id = values[0];
  if (!id || !SNOWFLAKE.test(id)) throw new ValidationError('Choose a member from the list.');
  return id;
}

/**
 * Buttons and selects: `tickets:<action>[:ticketId…]`. The id routes only —
 * each branch calls core as the clicking user, which authorizes.
 */
export const ticketComponents: ComponentHandler = {
  namespace: TICKETS_NS,
  async handle(h, action, args) {
    switch (action) {
      case ACTION.category:
        return showOpenForm(h);
      case ACTION.claim:
        return claim(h, ticketIdArg(args));
      case ACTION.close:
        return promptReason(h, ACTION.close, ticketIdArg(args));
      case ACTION.reopen:
        return promptReason(h, ACTION.reopen, ticketIdArg(args));
      case ACTION.transfer:
        return transferTo(h, ticketIdArg(args), chosenMember(h.interaction.values));
      case ACTION.priority:
        return applyPriority(h, ticketIdArg(args), h.interaction.values[0]);
      case ACTION.summary:
        return showSummary(h, ticketIdArg(args), isForced(args));
      case ACTION.queueClaim:
        return claim(h, ticketIdArg(h.interaction.values));
      case ACTION.view:
        return showTicket(h, ticketIdArg(h.interaction.values));
      default:
        return expired(h);
    }
  },
};

/** Modal submissions: open, close, reopen, waiting, internal note. */
export const ticketModals: ModalHandler = {
  namespace: TICKETS_NS,
  async handle(h, action, args) {
    switch (action) {
      case ACTION.open:
        return submitOpen(h, args);
      case ACTION.close:
      case ACTION.reopen:
      case ACTION.waiting:
        return submitReason(h, action, ticketIdArg(args));
      case ACTION.note:
        return submitNote(h, ticketIdArg(args));
      default:
        return expired(h);
    }
  },
};
