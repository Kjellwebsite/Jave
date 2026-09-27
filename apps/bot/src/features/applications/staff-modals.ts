import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { applications } from '@jave/core';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { applicationsId, type Decision, STAFF_ACTIONS } from './ids';
import { RECOMMENDATION_DESCRIPTIONS, RECOMMENDATION_LABELS } from './labels';
import { SCHEDULE_TIME_EXAMPLES } from './schedule-time';

/** Modal field ids. */
export const REVIEW_FIELDS = {
  recommendation: 'recommendation',
  score: 'score',
  note: 'note',
} as const;
export const INTERVIEW_FIELDS = { time: 'time', message: 'message' } as const;
export const DECISION_FIELDS = { reason: 'reason', message: 'message' } as const;

const REVIEW_SCORES = [5, 4, 3, 2, 1] as const;
const SCORE_DESCRIPTIONS: Readonly<Record<(typeof REVIEW_SCORES)[number], string>> = {
  5: 'Exceptional evidence of capability.',
  4: 'Strong. Clear proof of work.',
  3: 'Solid, with gaps.',
  2: 'Thin evidence.',
  1: 'No convincing evidence.',
};
const TIME_INPUT_CHARS = 64;
const LABEL_CHARS = 45;

const RECOMMENDATIONS = Object.keys(
  RECOMMENDATION_LABELS,
) as applications.ApplicationRecommendation[];

function title(text: string): string {
  return clip(text, LIMITS.modalTitle);
}

/** Recommendation (required), score 1–5 (not for an abstention) and an optional note. */
export function reviewModal(applicationId: string, number: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(applicationsId(STAFF_ACTIONS.reviewSubmit, applicationId))
    .setTitle(title(`REVIEW ${number}`))
    .addLabelComponents(
      new LabelBuilder().setLabel('Recommendation').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(REVIEW_FIELDS.recommendation)
          .setRequired(true)
          .addOptions(
            RECOMMENDATIONS.map((value) => ({
              label: RECOMMENDATION_LABELS[value],
              value,
              description: RECOMMENDATION_DESCRIPTIONS[value],
            })),
          ),
      ),
      new LabelBuilder()
        .setLabel('Score')
        .setDescription('1–5. Required, except when you abstain.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(REVIEW_FIELDS.score)
            .setRequired(false)
            .addOptions(
              REVIEW_SCORES.map((score) => ({
                label: String(score),
                value: String(score),
                description: SCORE_DESCRIPTIONS[score],
              })),
            ),
        ),
      new LabelBuilder()
        .setLabel('Note (staff only)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(REVIEW_FIELDS.note)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(applications.APPLICATION_FIELD_LIMITS.reviewNote)
            .setPlaceholder('What the evidence shows, and what it does not.'),
        ),
    )
    .toJSON();
}

/** Interview time (read in the staff member's zone) and an optional note to the applicant. */
export function interviewModal(
  applicationId: string,
  number: string,
  options: { timeZone: string; current: string | null },
): ModalPayload {
  const time = new TextInputBuilder()
    .setCustomId(INTERVIEW_FIELDS.time)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(TIME_INPUT_CHARS)
    .setPlaceholder(SCHEDULE_TIME_EXAMPLES);
  if (options.current) time.setValue(options.current);
  return new ModalBuilder()
    .setCustomId(applicationsId(STAFF_ACTIONS.interviewSubmit, applicationId))
    .setTitle(title(options.current ? `MOVE INTERVIEW — ${number}` : `INTERVIEW — ${number}`))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(clip(`When (${options.timeZone})`, LABEL_CHARS))
        .setDescription('Your time zone from dashboard preferences. Add UTC or +02:00 to override.')
        .setTextInputComponent(time),
      new LabelBuilder()
        .setLabel('Message to the applicant')
        .setDescription('Optional. Where to join, what to prepare.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(INTERVIEW_FIELDS.message)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(applications.APPLICATION_FIELD_LIMITS.interviewNote),
        ),
    )
    .toJSON();
}

/** Internal reason (required, staff only) and an optional message the applicant receives. */
export function decisionModal(
  decision: Decision,
  applicationId: string,
  number: string,
): ModalPayload {
  return new ModalBuilder()
    .setCustomId(applicationsId(STAFF_ACTIONS.decideSubmit, decision, applicationId))
    .setTitle(title(`${decision === 'accept' ? 'ACCEPT' : 'REJECT'} ${number}`))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Internal reason')
        .setDescription('Staff only. Recorded in the audit log; never shown to the applicant.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(DECISION_FIELDS.reason)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(applications.APPLICATION_FIELD_LIMITS.decisionReason),
        ),
      new LabelBuilder()
        .setLabel('Message to the applicant')
        .setDescription('Optional. Delivered with the outcome.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(DECISION_FIELDS.message)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(applications.APPLICATION_FIELD_LIMITS.applicantMessage),
        ),
    )
    .toJSON();
}
