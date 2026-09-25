import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Catalog, projects } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import {
  CONTRIBUTION_TITLE_MAX,
  CONTRIBUTION_TITLE_MIN,
  DATE_INPUT_LENGTH,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_TITLE_MAX,
  MODAL_TEXT_MAX,
  NO_PROJECT,
  PROJECT_TITLE_MAX,
  PROJECT_TITLE_MIN,
  PROJECTS_NS,
  REJECT_REASON_MAX,
  REJECT_REASON_MIN,
  SUMMARY_MAX,
  URL_MAX,
} from './constants';

/** Discord's limit on label descriptions inside modals. */
const LABEL_DESCRIPTION_MAX = 100;

export const MODAL_FIELDS = {
  title: 'title',
  summary: 'summary',
  description: 'description',
  visibility: 'visibility',
  domain: 'domain',
  dueDate: 'dueDate',
  kind: 'kind',
  url: 'url',
  reason: 'reason',
} as const;

const VISIBILITY_OPTIONS = [
  { value: 'members', label: 'MEMBERS', description: 'Signed-in JAVELIN members (recommended)' },
  { value: 'public', label: 'PUBLIC', description: 'Anyone, including the public dashboard' },
  { value: 'private', label: 'PRIVATE', description: 'Only the team and staff' },
] as const;

export const CONTRIBUTION_KIND_LABELS: Readonly<Record<projects.ContributionKind, string>> = {
  code: 'Code',
  research: 'Research',
  design: 'Design',
  writing: 'Writing',
  operations: 'Operations',
  mentoring: 'Mentoring',
  review: 'Review',
  other: 'Other',
};

function shortInput(id: string, max: number, required: boolean, min = 0): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(max)
    .setRequired(required);
  return min > 0 ? input.setMinLength(min) : input;
}

function paragraphInput(id: string, max: number, required: boolean, min = 0): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(max)
    .setRequired(required);
  return min > 0 ? input.setMinLength(min) : input;
}

/** /project create — title, summary, description, visibility, domain. */
export function createProjectModal(catalog: Catalog): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(PROJECTS_NS, 'create'))
    .setTitle('START A PROJECT')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Title')
        .setTextInputComponent(
          shortInput(MODAL_FIELDS.title, PROJECT_TITLE_MAX, true, PROJECT_TITLE_MIN),
        ),
      new LabelBuilder()
        .setLabel('Summary')
        .setDescription('One line. What it is and why it matters.')
        .setTextInputComponent(shortInput(MODAL_FIELDS.summary, SUMMARY_MAX, false)),
      new LabelBuilder()
        .setLabel('Description')
        .setTextInputComponent(paragraphInput(MODAL_FIELDS.description, MODAL_TEXT_MAX, false)),
      new LabelBuilder().setLabel('Visibility').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_FIELDS.visibility)
          .setRequired(true)
          .addOptions(VISIBILITY_OPTIONS.map((o) => ({ ...o, default: o.value === 'members' }))),
      ),
      new LabelBuilder()
        .setLabel('Domain')
        .setDescription('Optional.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(MODAL_FIELDS.domain)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1)
            .addOptions(
              catalog.domains.map((d) => ({
                value: d.key,
                label: d.label.toUpperCase(),
                description: clip(d.description, LABEL_DESCRIPTION_MAX),
              })),
            ),
        ),
    )
    .toJSON();
}

/** Add a milestone to one project. */
export function milestoneModal(projectId: string, projectTitle: string): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(PROJECTS_NS, 'msadd', projectId))
    .setTitle('ADD MILESTONE')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Milestone')
        .setDescription(clip(`For ${projectTitle}`, LABEL_DESCRIPTION_MAX))
        .setTextInputComponent(shortInput(MODAL_FIELDS.title, MILESTONE_TITLE_MAX, true)),
      new LabelBuilder()
        .setLabel('Details')
        .setTextInputComponent(
          paragraphInput(MODAL_FIELDS.description, MILESTONE_DESCRIPTION_MAX, false),
        ),
      new LabelBuilder()
        .setLabel('Due date')
        .setDescription('Optional. YYYY-MM-DD (UTC).')
        .setTextInputComponent(
          shortInput(MODAL_FIELDS.dueDate, DATE_INPUT_LENGTH, false, DATE_INPUT_LENGTH),
        ),
    )
    .toJSON();
}

/** Record your own contribution, optionally on a project you belong to. */
export function contributionModal(project: { id: string; title: string } | null): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(PROJECTS_NS, 'contribute', project?.id ?? NO_PROJECT))
    .setTitle('RECORD CONTRIBUTION')
    .addLabelComponents(
      new LabelBuilder().setLabel('Kind').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId(MODAL_FIELDS.kind)
          .setRequired(true)
          .addOptions(
            Object.entries(CONTRIBUTION_KIND_LABELS).map(([value, label]) => ({
              value,
              label,
              default: value === 'code',
            })),
          ),
      ),
      new LabelBuilder()
        .setLabel('What you did')
        .setDescription(
          clip(project ? `On ${project.title}` : 'Not tied to a project.', LABEL_DESCRIPTION_MAX),
        )
        .setTextInputComponent(
          shortInput(MODAL_FIELDS.title, CONTRIBUTION_TITLE_MAX, true, CONTRIBUTION_TITLE_MIN),
        ),
      new LabelBuilder()
        .setLabel('Link')
        .setDescription('Optional. Pull request, document, demo — https only.')
        .setTextInputComponent(shortInput(MODAL_FIELDS.url, URL_MAX, false)),
      new LabelBuilder()
        .setLabel('Details')
        .setTextInputComponent(paragraphInput(MODAL_FIELDS.description, MODAL_TEXT_MAX, false)),
    )
    .toJSON();
}

/** Reviewer's rejection reason (the author reads it). */
export function rejectModal(contributionId: string, queueIndex: number): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(PROJECTS_NS, 'creject', contributionId, queueIndex))
    .setTitle('REJECT CONTRIBUTION')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription('The author sees this. Be specific.')
        .setTextInputComponent(
          paragraphInput(MODAL_FIELDS.reason, REJECT_REASON_MAX, true, REJECT_REASON_MIN),
        ),
    )
    .toJSON();
}
