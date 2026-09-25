import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { calendar } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_OPTIONS,
  EVENT_ACTION,
  EVENTS_NS,
  type EventKindChoice,
  MODAL_LABEL_MAX,
  SCORE_INPUT_MAX_LENGTH,
} from './constants';
import { START_INPUT_MAX } from './time-input';

/** Field ids inside the events modals. */
export const FIELD = {
  title: 'title',
  description: 'description',
  start: 'start',
  duration: 'duration',
  location: 'location',
  code: 'code',
  reason: 'reason',
  scoreA: 'scoreA',
  scoreB: 'scoreB',
  winner: 'winner',
} as const;

/** Winner choices in the report modal; 'score' lets the scores decide. */
export const WINNER_BY_SCORE = 'score';
const WINNER_SLOTS = ['a', 'b'] as const;
export type WinnerChoice = (typeof WINNER_SLOTS)[number] | typeof WINNER_BY_SCORE;

export function isWinnerChoice(value: string | undefined): value is WinnerChoice {
  return value === WINNER_BY_SCORE || WINNER_SLOTS.some((slot) => slot === value);
}

const modalLabel = (text: string) => clip(text, MODAL_LABEL_MAX);

export function createEventModal(
  kind: EventKindChoice,
  capacity: number | null,
  timeZone: string,
): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(EVENTS_NS, EVENT_ACTION.create, kind, capacity ?? 0))
    .setTitle(modalLabel(`NEW ${kind.toUpperCase()}`))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Title')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.title)
            .setStyle(TextInputStyle.Short)
            .setMinLength(calendar.EVENT_TITLE_MIN)
            .setMaxLength(calendar.EVENT_TITLE_MAX)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('Description')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.description)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(calendar.EVENT_DESCRIPTION_MAX)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel('Start')
        .setDescription(clip(`YYYY-MM-DD HH:mm in ${timeZone}, or ISO 8601 with an offset.`, 100))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.start)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2026-10-02 18:00')
            .setMaxLength(START_INPUT_MAX)
            .setRequired(true),
        ),
      new LabelBuilder().setLabel('Duration').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(FIELD.duration)
          .setRequired(true)
          .addOptions(
            DURATION_OPTIONS.map((option) => ({
              label: option.label,
              value: String(option.minutes),
              default: option.minutes === DEFAULT_DURATION_MINUTES,
            })),
          ),
      ),
      new LabelBuilder()
        .setLabel('Location')
        .setDescription('Voice channel ID, an https:// link, or a place. Optional.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.location)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(calendar.EVENT_LOCATION_MAX)
            .setRequired(false),
        ),
    )
    .toJSON();
}

export function checkInModal(eventId: string, eventTitle: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(EVENTS_NS, EVENT_ACTION.checkIn, eventId))
    .setTitle(modalLabel('EVENT CHECK-IN'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Check-in code')
        .setDescription(clip(`Shared by the host of ${eventTitle}.`, 100))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.code)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('ABCD-EFGH')
            .setMinLength(1)
            .setMaxLength(calendar.CHECK_IN_CODE_INPUT_MAX)
            .setRequired(true),
        ),
    )
    .toJSON();
}

export function cancelEventModal(eventId: string, eventTitle: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(EVENTS_NS, EVENT_ACTION.cancel, eventId))
    .setTitle(modalLabel('CANCEL EVENT'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription(clip(`Sent to everyone who responded to ${eventTitle}.`, 100))
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD.reason)
            .setStyle(TextInputStyle.Short)
            .setMinLength(calendar.CANCEL_REASON_MIN)
            .setMaxLength(calendar.CANCEL_REASON_MAX)
            .setRequired(true),
        ),
    )
    .toJSON();
}

export function reportMatchModal(matchId: string, teamA: string, teamB: string): ModalPayload {
  const score = (id: string, team: string) =>
    new LabelBuilder()
      .setLabel(modalLabel(`Score · ${team}`))
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(id)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(SCORE_INPUT_MAX_LENGTH)
          .setRequired(false),
      );
  return new ModalBuilder()
    .setCustomId(customId(EVENTS_NS, EVENT_ACTION.report, matchId))
    .setTitle(modalLabel('REPORT RESULT'))
    .addLabelComponents(
      score(FIELD.scoreA, teamA),
      score(FIELD.scoreB, teamB),
      new LabelBuilder()
        .setLabel('Winner')
        .setDescription('Leave on "By score" unless it was a forfeit or a tied score.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD.winner)
            .setRequired(true)
            .addOptions(
              { label: 'By score', value: WINNER_BY_SCORE, default: true },
              { label: clip(`${teamA} wins`, 100), value: 'a' },
              { label: clip(`${teamB} wins`, 100), value: 'b' },
            ),
        ),
    )
    .toJSON();
}
