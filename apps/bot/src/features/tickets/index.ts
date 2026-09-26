import { tickets } from '@jave/core';
import type { BotFeature } from '../types';
import { ticketCommand } from './command';
import { ticketComponents, ticketModals } from './components';
import { closeThreadHandler } from './jobs/close-thread';
import { openThreadHandler } from './jobs/open-thread';
import { reopenThreadHandler } from './jobs/reopen-thread';
import { updateCardHandler } from './jobs/update-card';
import { onTicketMessage, onTicketMessageDelete, onTicketMessageUpdate } from './listeners';

/**
 * Discord surface for the tickets domain: /ticket, the public OPEN A TICKET
 * panel, the thread card's CLAIM / CLOSE / REOPEN buttons, the private-thread
 * job handlers and the transcript listeners. See docs/commands/tickets.md.
 */
export const feature: BotFeature = {
  name: 'tickets',
  commands: [ticketCommand],
  components: [ticketComponents],
  modals: [ticketModals],
  jobHandlers: (services) => ({
    [tickets.OPEN_THREAD_JOB]: openThreadHandler(services),
    [tickets.UPDATE_CARD_JOB]: updateCardHandler(services),
    [tickets.CLOSE_THREAD_JOB]: closeThreadHandler(services),
    [tickets.REOPEN_THREAD_JOB]: reopenThreadHandler(services),
  }),
  onMessage: onTicketMessage,
  onMessageUpdate: onTicketMessageUpdate,
  onMessageDelete: onTicketMessageDelete,
};
