import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import { tickets, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import {
  applyPriority,
  claim,
  promptNote,
  promptPriority,
  promptReason,
  promptTransfer,
  resume,
  transferTo,
  unclaim,
} from './actions';
import { ACTION } from './constants';
import { PRIORITY_LABELS } from './labels';
import { showMine, showQueue, showTicket, ticketChoices } from './lists';
import { postPanel, startOpen } from './open';
import { resolveTicketId, TICKET_OPTION } from './resolve';
import { showSummary } from './summary';

const TRANSFER_TARGET_OPTION = 'to';
const PRIORITY_OPTION = 'level';
const TICKET_OPTION_MAX_LENGTH = 100;

function withTicket(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.addStringOption((o) =>
    o
      .setName(TICKET_OPTION)
      .setDescription('Ticket (default: the ticket thread you are in)')
      .setAutocomplete(true)
      .setMaxLength(TICKET_OPTION_MAX_LENGTH),
  );
}

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Support tickets: open one, or handle them as staff.')
  .addSubcommand((s) => s.setName('open').setDescription('Open a private support ticket.'))
  .addSubcommand((s) => s.setName('mine').setDescription('Your tickets and their status.'))
  .addSubcommand((s) => withTicket(s.setName('view').setDescription('One ticket at a glance.')))
  .addSubcommand((s) =>
    s.setName('panel').setDescription('Staff: post the OPEN A TICKET panel in this channel.'),
  )
  .addSubcommand((s) =>
    s.setName('queue').setDescription('Staff: active tickets, most urgent deadline first.'),
  )
  .addSubcommand((s) => withTicket(s.setName('claim').setDescription('Staff: take a ticket.')))
  .addSubcommand((s) =>
    withTicket(s.setName('unclaim').setDescription('Staff: release your claim.')),
  )
  .addSubcommand((s) =>
    withTicket(
      s.setName('transfer').setDescription('Staff: hand a ticket to another handler.'),
    ).addUserOption((o) =>
      o.setName(TRANSFER_TARGET_OPTION).setDescription('New handler (default: choose from a list)'),
    ),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('priority').setDescription('Staff: change the priority.')).addStringOption(
      (o) =>
        o
          .setName(PRIORITY_OPTION)
          .setDescription('New priority (default: choose from a list)')
          .addChoices(
            ...tickets.TICKET_PRIORITIES.map((value) => ({
              name: PRIORITY_LABELS[value].label,
              value,
            })),
          ),
    ),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('waiting').setDescription('Staff: wait on the requester, with a reason.')),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('resume').setDescription('Staff: take a waiting ticket back.')),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('close').setDescription('Close a ticket, with a reason.')),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('reopen').setDescription('Reopen a closed ticket, with a reason.')),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('note').setDescription('Staff: add an internal note. Never posted.')),
  )
  .addSubcommand((s) =>
    withTicket(s.setName('summary').setDescription('Staff: AI summary of the conversation.')),
  )
  .toJSON();

async function perTicket(h: HandlerContext, sub: string): Promise<void> {
  const ticketId = await resolveTicketId(h);
  const o = h.interaction.options;
  switch (sub) {
    case 'view':
      return showTicket(h, ticketId);
    case 'claim':
      return claim(h, ticketId);
    case 'unclaim':
      return unclaim(h, ticketId);
    case 'transfer': {
      const target = o.user(TRANSFER_TARGET_OPTION);
      return target ? transferTo(h, ticketId, target.id) : promptTransfer(h, ticketId);
    }
    case 'priority': {
      const level = o.string(PRIORITY_OPTION);
      return level ? applyPriority(h, ticketId, level) : promptPriority(h, ticketId);
    }
    case 'waiting':
      return promptReason(h, ACTION.waiting, ticketId);
    case 'resume':
      return resume(h, ticketId);
    case 'close':
      return promptReason(h, ACTION.close, ticketId);
    case 'reopen':
      return promptReason(h, ACTION.reopen, ticketId);
    case 'note':
      return promptNote(h, ticketId);
    case 'summary':
      return showSummary(h, ticketId, false);
    default:
      throw new ValidationError('Unknown subcommand.');
  }
}

/** /ticket — every ticket flow, context-aware inside a ticket thread. */
export const ticketCommand: CommandDefinition = {
  kind: 'slash',
  data,
  help: {
    category: 'operations',
    summary: 'Open a private support ticket. Staff claim, triage and close tickets here.',
    usage:
      '/ticket open | mine | view · staff: queue | claim | transfer | priority | waiting | note | summary | close',
  },

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (focused?.name !== TICKET_OPTION) return h.interaction.autocomplete([]);
    return h.interaction.autocomplete(await ticketChoices(h, focused.value));
  },

  async execute(h) {
    const sub = h.interaction.options.subcommand() ?? '';
    switch (sub) {
      case 'open':
        return startOpen(h);
      case 'mine':
        return showMine(h);
      case 'panel':
        return postPanel(h);
      case 'queue':
        return showQueue(h);
      default:
        return perTicket(h, sub);
    }
  },
};
