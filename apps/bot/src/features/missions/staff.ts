import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { missions, ValidationError } from '@jave/core';
import type { HandlerContext, ModalPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, panel, row, success } from '../../ui/components';
import { plainText } from '../../ui/format';
import { COLORS, LIMITS } from '../../ui/theme';
import { parseDeadline, parseHours } from './data';
import { presentInPlace } from './present';
import { missionHeadline, MISSIONS_NS, TYPE_LABEL } from './render';
import { ensureManager } from './staff-access';
import { detailPayload } from './views';

/** Field ids inside the create and edit modals. */
export const FIELD_TITLE = 'title';
export const FIELD_TYPE = 'type';
export const FIELD_BRIEF = 'brief';
export const FIELD_HOURS = 'hours';
export const FIELD_DEADLINE = 'deadline';
export const FIELD_SLOTS = 'slots';
/** Discord text inputs hold at most 4000 characters. */
const TEXT_INPUT_MAX = 4000;
const SLOTS_PATTERN = /^\d{1,4}$/;
const DEADLINE_EXAMPLE = 'YYYY-MM-DD HH:MM';
const TYPE_DESCRIPTION: Record<missions.MissionType, string> = {
  individual: 'One member, one result.',
  team: 'Staff form teams; one submission counts for the team.',
  research: 'Investigate and report.',
  build: 'Ship something that works.',
  social: 'Work with people.',
  physical: 'Training and physical results.',
  strategy: 'Plans, decisions, analysis.',
  creative: 'Design, writing, media.',
};

function textInput(id: string, style: TextInputStyle, min: number, max: number, required: boolean) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setStyle(style)
    .setMinLength(min)
    .setMaxLength(Math.min(max, TEXT_INPUT_MAX))
    .setRequired(required);
}

function hoursInput(value: number | null): TextInputBuilder {
  const input = textInput(FIELD_HOURS, TextInputStyle.Short, 0, 4, false).setPlaceholder('72');
  if (value !== null) input.setValue(String(value));
  return input;
}

function formatDeadline(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '';
}

function deadlineInput(value: Date | null): TextInputBuilder {
  const input = textInput(FIELD_DEADLINE, TextInputStyle.Short, 0, 16, false).setPlaceholder(
    DEADLINE_EXAMPLE,
  );
  const formatted = formatDeadline(value);
  if (formatted) input.setValue(formatted);
  return input;
}

function hoursField(value: number | null, description: string): LabelBuilder {
  return new LabelBuilder()
    .setLabel('Time limit (hours)')
    .setDescription(description)
    .setTextInputComponent(hoursInput(value));
}

function deadlineField(value: Date | null, description: string): LabelBuilder {
  return new LabelBuilder()
    .setLabel('Deadline (UTC)')
    .setDescription(`${DEADLINE_EXAMPLE}. ${description}`)
    .setTextInputComponent(deadlineInput(value));
}

// ── Create ──────────────────────────────────────────────────────────────────

export function createModal(): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, 'create'))
    .setTitle('NEW MISSION')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Title')
        .setTextInputComponent(
          textInput(
            FIELD_TITLE,
            TextInputStyle.Short,
            missions.TITLE_MIN,
            missions.TITLE_MAX,
            true,
          ),
        ),
      new LabelBuilder()
        .setLabel('Type')
        .setDescription('Only team missions change mechanics.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD_TYPE)
            .setRequired(true)
            .addOptions(
              missions.MISSION_TYPES.map((type) => ({
                label: TYPE_LABEL[type],
                description: TYPE_DESCRIPTION[type],
                value: type,
              })),
            ),
        ),
      new LabelBuilder()
        .setLabel('Brief')
        .setDescription('What to do, what counts as done, what evidence to bring.')
        .setTextInputComponent(
          textInput(
            FIELD_BRIEF,
            TextInputStyle.Paragraph,
            missions.BRIEF_MIN,
            missions.BRIEF_MAX,
            true,
          ),
        ),
      hoursField(null, 'Per assignment, from when it starts. Blank for none.'),
      deadlineField(null, 'The mission closes then. Blank for none.'),
    )
    .toJSON();
}

/** `/mission create`: staff only, straight into the form. */
export async function openCreate(h: HandlerContext): Promise<void> {
  if (!(await ensureManager(h))) return;
  await h.interaction.showModal(createModal());
}

function typeFromModal(h: HandlerContext): missions.MissionType {
  const [value] = h.interaction.modal.select(FIELD_TYPE);
  const type = missions.MISSION_TYPES.find((candidate) => candidate === value);
  if (!type) throw new ValidationError('type: choose a mission type');
  return type;
}

/** Create the draft, then show it with its staff controls. */
export async function createFromModal(h: HandlerContext): Promise<void> {
  const { modal } = h.interaction;
  const draft = await missions.createMission(h.ctx, {
    title: modal.text(FIELD_TITLE),
    brief: modal.text(FIELD_BRIEF),
    type: typeFromModal(h),
    durationHours: parseHours(modal.text(FIELD_HOURS), 'durationHours'),
    deadlineAt: parseDeadline(modal.text(FIELD_DEADLINE)),
  });
  const notice = success(
    'Draft created',
    `${missionHeadline(missions.formatMissionNumber(draft.number), draft.title)}.\nSETTINGS sets capability, reward and evidence. PUBLISH opens it and posts the card.`,
  );
  await h.respond(await detailPayload(h, draft.id, notice));
}

// ── Edit ────────────────────────────────────────────────────────────────────

function slotsInput(value: number | null): TextInputBuilder {
  const input = textInput(FIELD_SLOTS, TextInputStyle.Short, 0, 4, false).setPlaceholder('10');
  if (value !== null) input.setValue(String(value));
  return input;
}

export function editModal(mission: missions.MissionSummary): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, 'edit', mission.id))
    .setTitle(plainText(`EDIT ${mission.number}`, LIMITS.modalTitle))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Title')
        .setTextInputComponent(
          textInput(
            FIELD_TITLE,
            TextInputStyle.Short,
            missions.TITLE_MIN,
            missions.TITLE_MAX,
            true,
          ).setValue(mission.title),
        ),
      new LabelBuilder()
        .setLabel('Brief')
        .setTextInputComponent(
          textInput(
            FIELD_BRIEF,
            TextInputStyle.Paragraph,
            missions.BRIEF_MIN,
            missions.BRIEF_MAX,
            true,
          ).setValue(mission.brief.slice(0, TEXT_INPUT_MAX)),
        ),
      hoursField(mission.durationHours, 'New assignments only. Blank for none.'),
      deadlineField(mission.deadlineAt, 'Existing due dates stay. Blank for none.'),
      new LabelBuilder()
        .setLabel('Slots')
        .setDescription('Most members holding it at once. Blank for no cap.')
        .setTextInputComponent(slotsInput(mission.maxAssignees)),
    )
    .toJSON();
}

export async function openEdit(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  await h.interaction.showModal(editModal(mission));
}

/** Optional whole number of slots, or null for no cap. */
export function parseSlots(value: string): number | null {
  const raw = value.trim();
  if (raw === '') return null;
  const slots = Number(raw);
  if (!SLOTS_PATTERN.test(raw) || slots < 1 || slots > missions.MAX_ASSIGNEES_LIMIT)
    throw new ValidationError(
      `maxAssignees: a whole number from 1 to ${missions.MAX_ASSIGNEES_LIMIT}`,
    );
  return slots;
}

/**
 * The deadline typed into the edit modal. The modal shows the stored deadline
 * to the minute; left as shown, it stays exactly as stored (undefined), so
 * the edit neither shifts it nor re-validates a deadline that has passed.
 */
export function editedDeadline(typed: string, stored: Date | null): Date | null | undefined {
  const value = typed.trim();
  return value === formatDeadline(stored) ? undefined : parseDeadline(value);
}

export async function editFromModal(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { modal } = h.interaction;
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  const updated = await missions.updateMission(h.ctx, {
    missionId,
    patch: {
      title: modal.text(FIELD_TITLE),
      brief: modal.text(FIELD_BRIEF),
      durationHours: parseHours(modal.text(FIELD_HOURS), 'durationHours'),
      deadlineAt: editedDeadline(modal.text(FIELD_DEADLINE), mission.deadlineAt),
      maxAssignees: parseSlots(modal.text(FIELD_SLOTS)),
    },
  });
  const notice = success(
    'Mission updated',
    `${missionHeadline(missions.formatMissionNumber(updated.number), updated.title)}. A posted card follows the change.`,
  );
  await presentInPlace(h, await detailPayload(h, missionId, notice));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** PUBLISH asks how: announced in the missions channel, or opened quietly. */
export async function confirmPublish(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  await h.respond({
    embeds: [
      panel({
        kicker: 'CONFIRM',
        title: 'Publish mission',
        description: `${missionHeadline(mission.number, mission.title)}.\nMembers see it immediately. ANNOUNCE also posts the card with ACCEPT in the missions channel.`,
      }),
    ],
    components: [
      row(
        button('Publish & announce', customId(MISSIONS_NS, 'publish_go', missionId, 1), 'success'),
        button('Publish quietly', customId(MISSIONS_NS, 'publish_go', missionId, 0)),
      ),
    ],
    ephemeral: true,
  });
}

export async function publish(h: HandlerContext, missionId: string, announce: boolean) {
  const { mission, announced } = await missions.publishMission(h.ctx, { missionId, announce });
  const where = announced
    ? 'The card is posting to the missions channel.'
    : announce
      ? 'No missions or announcements channel is configured, so no card was posted.'
      : 'Opened without a card.';
  const notice = success(
    'Mission published',
    `${missionHeadline(missions.formatMissionNumber(mission.number), mission.title)}. ${where}`,
  );
  await presentInPlace(h, await detailPayload(h, missionId, notice));
}

export async function close(h: HandlerContext, missionId: string): Promise<void> {
  const mission = await missions.closeMission(h.ctx, { missionId });
  const notice = success(
    'Mission closed',
    `${missionHeadline(missions.formatMissionNumber(mission.number), mission.title)}. No new assignments; work in progress continues.`,
  );
  await presentInPlace(h, await detailPayload(h, missionId, notice));
}

export async function reopen(h: HandlerContext, missionId: string): Promise<void> {
  const mission = await missions.reopenMission(h.ctx, { missionId });
  const notice = success(
    'Mission reopened',
    `${missionHeadline(missions.formatMissionNumber(mission.number), mission.title)}. Open for assignments again.`,
  );
  await presentInPlace(h, await detailPayload(h, missionId, notice));
}

/** ARCHIVE is final: confirm first. */
export async function confirmArchive(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  await h.respond({
    embeds: [
      panel({
        kicker: 'CONFIRM',
        title: 'Archive mission',
        description: `${missionHeadline(mission.number, mission.title)}.\nArchiving is final. Work in progress expires with a notice; submissions awaiting review block it.`,
        color: COLORS.warning,
      }),
    ],
    components: [
      row(
        button('Archive mission', customId(MISSIONS_NS, 'archive_go', missionId), 'danger'),
        button('Keep it', customId(MISSIONS_NS, 'dismiss')),
      ),
    ],
    ephemeral: true,
  });
}

export async function archive(h: HandlerContext, missionId: string): Promise<void> {
  const mission = await missions.archiveMission(h.ctx, { missionId });
  await presentInPlace(h, {
    embeds: [
      success(
        'Mission archived',
        `${missionHeadline(missions.formatMissionNumber(mission.number), mission.title)}. It stays in the record; members no longer see it.`,
      ),
    ],
    components: [],
  });
}
