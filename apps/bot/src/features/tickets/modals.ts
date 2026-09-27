import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { tickets } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import { ACTION, FIELD, INPUT_LIMITS, MODAL_TITLE_MAX, TICKETS_NS } from './constants';
import { CATEGORY_LABELS, priorityOptions } from './labels';

/** The open-ticket form, reached after choosing a category. */
export function openTicketModal(category: tickets.TicketCategory): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(TICKETS_NS, ACTION.open, category))
    .setTitle(clip(`OPEN TICKET — ${CATEGORY_LABELS[category].label}`, MODAL_TITLE_MAX))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Subject')
        .setDescription('One line. What do you need?')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.subject)
            .setStyle(TextInputStyle.Short)
            .setMinLength(INPUT_LIMITS.subject.min)
            .setMaxLength(INPUT_LIMITS.subject.max)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Details')
        .setDescription('Context, what you tried, links. Staff read this first.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.body)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(INPUT_LIMITS.body.min)
            .setMaxLength(INPUT_LIMITS.body.max)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Priority')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.priority)
            .setRequired(true)
            .addOptions(priorityOptions('normal')),
        ),
    )
    .toJSON();
}

export type ReasonAction = typeof ACTION.close | typeof ACTION.reopen | typeof ACTION.waiting;

const REASON_COPY: Record<ReasonAction, { title: string; label: string; description: string }> = {
  close: {
    title: 'CLOSE',
    label: 'Reason',
    description: 'Shown to the requester in the thread.',
  },
  reopen: {
    title: 'REOPEN',
    label: 'Reason',
    description: 'Why the ticket continues. Posted in the thread.',
  },
  waiting: {
    title: 'WAITING ON REQUESTER',
    label: 'What the requester needs to do',
    description: 'Addressed to the requester. Posted in the thread.',
  },
};

/** Close, reopen and waiting all take one reason addressed to the thread. */
export function reasonModal(
  action: ReasonAction,
  ticketId: string,
  reference: string,
): ModalPayload {
  const copy = REASON_COPY[action];
  return new ModalBuilder()
    .setCustomId(customId(TICKETS_NS, action, ticketId))
    .setTitle(clip(`${copy.title} ${reference}`, MODAL_TITLE_MAX))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(copy.label)
        .setDescription(copy.description)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.reason)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(INPUT_LIMITS.reason.min)
            .setMaxLength(INPUT_LIMITS.reason.max)
            .setRequired(true),
        ),
    )
    .toJSON();
}

/** Internal note: staff only, never posted to the thread. */
export function noteModal(ticketId: string, reference: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(TICKETS_NS, ACTION.note, ticketId))
    .setTitle(clip(`INTERNAL NOTE ${reference}`, MODAL_TITLE_MAX))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Note')
        .setDescription('Staff only. Never posted to the thread or shown to the requester.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.note)
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(INPUT_LIMITS.note.min)
            .setMaxLength(INPUT_LIMITS.note.max)
            .setRequired(true),
        ),
    )
    .toJSON();
}
