import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { trials } from '@jave/core';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import { LIMITS as UI_LIMITS } from '../../ui/theme';
import { FIELDS, MEMBER_ACTIONS, STAFF_ACTIONS, trialsId } from './ids';
import { SCORE_MAX, SCORE_MIN } from './render/labels';

/** Discord caps a text input at 4000 characters. */
const TEXT_INPUT_MAX = 4000;
/** Discord caps a label's description at 100 characters. */
const LABEL_DESCRIPTION_MAX = 100;
/** A modal holds at most five labelled components: four scores and the notes. */
export const QUICK_EVALUATION_MAX_CRITERIA = 4;
const SCORE_INPUT_MAX = 2;
const TEAM_SIZE_INPUT_MAX = 2;
const COUNT_INPUT_MAX = 3;
const MINUTES_INPUT_MAX = 5;

const title = (text: string) => clip(text.toUpperCase(), UI_LIMITS.modalTitle);

function text(
  id: string,
  options: {
    style?: TextInputStyle;
    min?: number;
    max: number;
    required?: boolean;
    value?: string;
    placeholder?: string;
  },
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(options.style ?? TextInputStyle.Short)
    .setMaxLength(Math.min(options.max, TEXT_INPUT_MAX))
    .setRequired(options.required ?? true);
  if (options.min) input.setMinLength(options.min);
  if (options.value) input.setValue(options.value.slice(0, Math.min(options.max, TEXT_INPUT_MAX)));
  if (options.placeholder) input.setPlaceholder(options.placeholder);
  return input;
}

function label(name: string, input: TextInputBuilder, description?: string): LabelBuilder {
  const builder = new LabelBuilder()
    .setLabel(clip(name, UI_LIMITS.modalTitle))
    .setTextInputComponent(input);
  if (description) builder.setDescription(clip(description, LABEL_DESCRIPTION_MAX));
  return builder;
}

export function applyModal(trialId: string, ref: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(trialsId(MEMBER_ACTIONS.apply, trialId))
    .setTitle(title(`Apply — ${ref}`))
    .addLabelComponents(
      label(
        'Statement',
        text(FIELDS.statement, {
          style: TextInputStyle.Paragraph,
          min: trials.LIMITS.statementMin,
          max: trials.LIMITS.statement,
        }),
        'Why this trial, and what you have already shipped. Staff read it.',
      ),
    )
    .toJSON();
}

export interface SubmitModalContext {
  /** The version this submission becomes. */
  nextVersion: number;
  /** Past the deadline, inside the late window: accepted and flagged. */
  late: boolean;
  /** The team's latest version, prefilled so a resubmission is an edit. */
  previous: { summary: string; links: readonly string[] } | null;
}

export function submitModal(trialId: string, context: SubmitModalContext): ModalPayload {
  const version = `Becomes version ${context.nextVersion}.`;
  return new ModalBuilder()
    .setCustomId(trialsId(MEMBER_ACTIONS.submit, trialId))
    .setTitle(title(context.late ? 'Team submission — late' : 'Team submission'))
    .addLabelComponents(
      label(
        'Summary',
        text(FIELDS.summary, {
          style: TextInputStyle.Paragraph,
          min: trials.LIMITS.submissionSummaryMin,
          max: trials.LIMITS.submissionSummary,
          value: context.previous?.summary,
        }),
        context.late
          ? `${version} Past the deadline: accepted, flagged LATE.`
          : `${version} What the team delivered. Outcomes, not effort.`,
      ),
      label(
        'Links',
        text(FIELDS.links, {
          style: TextInputStyle.Paragraph,
          max: TEXT_INPUT_MAX,
          required: false,
          placeholder: 'https://…',
          value: context.previous?.links.join('\n'),
        }),
        `One http(s) link per line, up to ${trials.LIMITS.submissionLinks}.`,
      ),
    )
    .toJSON();
}

export function randomSelectionModal(trialId: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(trialsId(STAFF_ACTIONS.selectRandom, trialId))
    .setTitle(title('Random selection'))
    .addLabelComponents(
      label(
        'How many',
        text(FIELDS.count, { max: COUNT_INPUT_MAX, placeholder: '12' }),
        'Drawn from eligible applicants. Replaces the current selection.',
      ),
      label(
        'Seed',
        text(FIELDS.seed, { max: trials.LIMITS.seed, required: false }),
        'Optional. Reuse a seed to reproduce a draw.',
      ),
    )
    .toJSON();
}

export function assignModal(trialId: string, teamSize: number): ModalPayload {
  return new ModalBuilder()
    .setCustomId(trialsId(STAFF_ACTIONS.assign, trialId))
    .setTitle(title('Assign teams'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Strategy')
        .setDescription('Balanced spreads primary domains across teams.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELDS.strategy)
            .setRequired(true)
            .addOptions(
              { label: 'BALANCED', value: 'balanced', default: true },
              { label: 'RANDOM', value: 'random' },
            ),
        ),
      label(
        'Team size',
        text(FIELDS.teamSize, {
          max: TEAM_SIZE_INPUT_MAX,
          required: false,
          value: String(teamSize),
        }),
        `Target members per team (${trials.MAX_TEAM_SIZE} at most).`,
      ),
      label(
        'Seed',
        text(FIELDS.seed, { max: trials.LIMITS.seed, required: false }),
        'Optional. The seed is recorded; the same seed reproduces the teams.',
      ),
    )
    .toJSON();
}

export function extendModal(trialId: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(trialsId(STAFF_ACTIONS.extend, trialId))
    .setTitle(title('Extend deadline'))
    .addLabelComponents(
      label('Minutes', text(FIELDS.minutes, { max: MINUTES_INPUT_MAX, placeholder: '60' })),
      label(
        'Reason',
        text(FIELDS.reason, {
          style: TextInputStyle.Paragraph,
          min: trials.LIMITS.reasonMin,
          max: trials.LIMITS.reason,
        }),
        'Sent to every competitor with the new deadline.',
      ),
    )
    .toJSON();
}

export function cancelModal(trialId: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(trialsId(STAFF_ACTIONS.cancel, trialId))
    .setTitle(title('Cancel trial'))
    .addLabelComponents(
      label(
        'Reason',
        text(FIELDS.reason, {
          style: TextInputStyle.Paragraph,
          min: trials.LIMITS.reasonMin,
          max: trials.LIMITS.reason,
        }),
        'Sent to every stakeholder. Cancelling cannot be undone.',
      ),
    )
    .toJSON();
}

/**
 * Quick evaluation: one score field per criterion (≤ 4) plus notes. Larger
 * rubrics are scored in the dashboard, where the whole grid fits.
 */
export function evaluationModal(input: {
  trialId: string;
  teamId: string;
  teamName: string;
  rubric: readonly trials.RubricView[];
  previous: Readonly<Record<string, number>> | null;
  previousNotes: string | null;
}): ModalPayload {
  const scores = input.rubric.slice(0, QUICK_EVALUATION_MAX_CRITERIA).map((criterion, index) =>
    label(
      criterion.label,
      text(`${FIELDS.scorePrefix}${index}`, {
        max: SCORE_INPUT_MAX,
        placeholder: `${SCORE_MIN}–${SCORE_MAX}`,
        value:
          input.previous && Object.hasOwn(input.previous, criterion.key)
            ? String(input.previous[criterion.key])
            : undefined,
      }),
      `${SCORE_MIN}–${SCORE_MAX} · weight ${criterion.weightPercent}%${criterion.description ? ` · ${criterion.description}` : ''}`,
    ),
  );
  return new ModalBuilder()
    .setCustomId(trialsId(STAFF_ACTIONS.evaluate, input.trialId, input.teamId))
    .setTitle(title(`Evaluate ${input.teamName}`))
    .addLabelComponents(
      ...scores,
      label(
        'Notes',
        text(FIELDS.notes, {
          style: TextInputStyle.Paragraph,
          max: trials.LIMITS.notes,
          required: false,
          value: input.previousNotes ?? undefined,
        }),
        'Staff only. Replaces your earlier evaluation of this team.',
      ),
    )
    .toJSON();
}
