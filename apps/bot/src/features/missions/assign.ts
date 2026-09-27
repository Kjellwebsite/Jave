import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getMemberById, isSnowflake, missions } from '@jave/core';
import type { HandlerContext, ModalPayload, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, success, userSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  decodeAssignOptions,
  encodeAssignOptions,
  parseHours,
  parseTeamKey,
  resolveAssignees,
} from './data';
import { missionHeadline, MISSIONS_NS } from './render';
import { ensureManager } from './staff-access';

/** Field ids inside the team and time-limit modal. */
export const FIELD_TEAM = 'team';
export const FIELD_ASSIGN_HOURS = 'hours';
const TEAM_KEY_MAX = 32;
const NAME_MAX = 64;

const SKIP_LABEL: Record<missions.AssignSkipReason, string> = {
  not_found: 'no JVLN profile',
  ineligible: 'standing does not allow it',
  already_assigned: 'already on it',
  completed: 'already verified',
  team_locked: 'on another team for this mission',
  mission_full: 'no slot left',
};

interface AssignOptions {
  teamKey: string | null;
  durationHours: number | null;
}

/** The assign panel: who (user select, up to 25) plus team and time limit (modal). */
export async function assignPanel(
  h: HandlerContext,
  missionId: string,
  options: AssignOptions,
): Promise<ReplyPayload> {
  const detail = await missions.getMissionDetail(h.ctx, { missionId });
  const { mission } = detail;
  const team = mission.type === 'team';
  const needsTeam = team && options.teamKey === null;
  const facts = [
    field('Slots', detail.slotsLeft === null ? 'No cap' : `${detail.slotsLeft} left`, true),
    field(
      'Time limit',
      options.durationHours
        ? `${options.durationHours}h (override)`
        : mission.durationHours
          ? `${mission.durationHours}h`
          : GLYPH.unknown,
      true,
    ),
  ];
  if (team) facts.push(field('Team', options.teamKey ? `\`${options.teamKey}\`` : 'Not set', true));
  const components: NonNullable<ReplyPayload['components']> = [];
  if (!needsTeam) {
    components.push(
      row(
        userSelect(
          customId(
            MISSIONS_NS,
            'assign_pick',
            missionId,
            ...encodeAssignOptions(options.teamKey, options.durationHours),
          ),
          team ? `Members of team ${options.teamKey}` : 'Members to assign',
          { min: 1, max: missions.MAX_ASSIGN_BATCH },
        ),
      ),
    );
  }
  components.push(
    row(
      button(
        team ? 'Team & time limit' : 'Time limit',
        customId(MISSIONS_NS, 'assign_opts', missionId),
        needsTeam ? 'primary' : 'secondary',
      ),
    ),
  );
  return {
    embeds: [
      panel({
        kicker: `ASSIGN ${GLYPH.dot} ${mission.number}`,
        title: userText(mission.title, missions.TITLE_MAX),
        description: needsTeam
          ? 'Team mission: set a team key first. Members sharing it submit together.'
          : 'Pick members. They are notified and accept before they start. You cannot assign yourself.',
        fields: facts,
      }),
    ],
    components,
    ephemeral: true,
  };
}

/** ASSIGN button or `/mission assign`: staff only. */
export async function openAssign(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  await h.respond(await assignPanel(h, missionId, { teamKey: null, durationHours: null }));
}

export function assignOptionsModal(missionId: string, team: boolean): ModalPayload {
  const hours = new LabelBuilder()
    .setLabel('Time limit (hours)')
    .setDescription('Overrides the mission default for these members. Blank keeps it.')
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(FIELD_ASSIGN_HOURS)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(4)
        .setRequired(false)
        .setPlaceholder('72'),
    );
  const modal = new ModalBuilder()
    .setCustomId(customId(MISSIONS_NS, 'assign_opts', missionId))
    .setTitle(team ? 'TEAM & TIME LIMIT' : 'TIME LIMIT');
  if (team) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Team key')
        .setDescription('1–32 characters: a–z, 0–9, - or _. Members sharing it submit together.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(FIELD_TEAM)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(TEAM_KEY_MAX)
            .setRequired(true)
            .setPlaceholder('team-1'),
        ),
    );
  }
  return modal.addLabelComponents(hours).toJSON();
}

export async function openAssignOptions(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  await h.interaction.showModal(assignOptionsModal(missionId, mission.type === 'team'));
}

/** Team key and time limit set: show the panel again, now carrying them. */
export async function assignOptionsFromModal(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  const { modal } = h.interaction;
  const options = {
    teamKey: parseTeamKey(modal.text(FIELD_TEAM)),
    durationHours: parseHours(modal.text(FIELD_ASSIGN_HOURS), 'durationHours'),
  };
  await h.respond(await assignPanel(h, missionId, options));
}

async function nameOf(h: HandlerContext, memberId: string): Promise<string> {
  return userText((await getMemberById(h.ctx, memberId)).displayName, NAME_MAX);
}

/** Members picked: assign through core; skipped members are reported with the reason. */
export async function assignPicked(
  h: HandlerContext,
  missionId: string,
  encoded: readonly string[],
): Promise<void> {
  if (!(await ensureManager(h))) return;
  const options = decodeAssignOptions(encoded);
  const { memberIds, unknown } = await resolveAssignees(h, h.interaction.values);
  const lines: string[] = [];
  let assignedCount = 0;
  if (memberIds.length > 0) {
    const result = await missions.assignMission(h.ctx, {
      missionId,
      memberIds,
      teamKey: options.teamKey ?? undefined,
      durationHours: options.durationHours ?? undefined,
    });
    assignedCount = result.assigned.length;
    for (const assignment of result.assigned)
      lines.push(`${GLYPH.verified} ${await nameOf(h, assignment.memberId)}`);
    for (const skip of result.skipped)
      lines.push(`${GLYPH.cross} ${await nameOf(h, skip.memberId)} — ${SKIP_LABEL[skip.reason]}`);
  }
  for (const discordId of unknown) {
    // Picked ids come from Discord, but the custom id route is untrusted: echo only snowflakes.
    const who = isSnowflake(discordId) ? `<@${discordId}>` : 'Unknown user';
    lines.push(`${GLYPH.cross} ${who} — ${SKIP_LABEL.not_found}`);
  }
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  const headline = missionHeadline(mission.number, mission.title);
  const summary =
    assignedCount > 0
      ? success(
          `${assignedCount} assigned`,
          `${headline}.\n${lines.join('\n')}\nThey are notified and accept before they start.`,
        )
      : panel({
          title: 'NOBODY ASSIGNED',
          description: `${headline}.\n${lines.join('\n')}`,
          color: COLORS.warning,
        });
  await h.interaction.update({ embeds: [summary], components: [] });
}
