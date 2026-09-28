import type { APIButtonComponent, APIEmbed } from 'discord.js';
import { can, missions } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { discordTime, plainText, userText } from '../../ui/format';
import { GLYPH, LIMITS } from '../../ui/theme';
import { facetLabelOf } from './data';
import {
  ASSIGNMENT_GLYPH,
  ASSIGNMENT_LABEL,
  dashboardMissionUrl,
  missionEmbed,
  missionHeadline,
  MISSIONS_NS,
  ownAssignmentField,
  rewardTitle,
  showsDueDate,
  slotsOf,
  TYPE_LABEL,
  type MissionType,
} from './render';
import { missionReviewId } from './review';

/** Open missions per page: five ACCEPT buttons fill exactly one row. */
export const LIST_PAGE_SIZE = 5;
/** Own missions listed in one message (the select holds up to 25). */
export const MINE_SHOWN = 15;
const SELECT_LABEL_MAX = 100;
const ALL_TYPES = 'all';

export type MineScope = 'active' | 'completed' | 'all';
export const MINE_SCOPES: readonly MineScope[] = ['active', 'completed', 'all'];

function selectOptionFor(item: { id: string; number: string; title: string; type: MissionType }) {
  return {
    label: plainText(`${item.number} · ${item.title}`, SELECT_LABEL_MAX),
    description: TYPE_LABEL[item.type],
    value: item.id,
  };
}

// ── Open missions ───────────────────────────────────────────────────────────

/** ACCEPT on a list row: take a self-assignable mission, or accept a staff assignment. */
function canAcceptFromList(item: missions.OpenMissionItem): boolean {
  if (item.myAssignment) return item.myAssignment.status === 'assigned';
  return item.selfAssignable && item.type !== 'team' && item.slotsLeft !== 0;
}

function openLine(item: missions.OpenMissionItem): string {
  const facts = [
    `\`${TYPE_LABEL[item.type]}\``,
    item.type === 'team'
      ? 'teams by staff'
      : slotsOf(item.slotsLeft, item.maxAssignees).toLowerCase(),
    item.deadlineAt ? `closes ${discordTime(item.deadlineAt, 'R')}` : null,
    item.reward ? `reward ${userText(rewardTitle(item.reward), 80)}` : null,
    item.myAssignment
      ? `${ASSIGNMENT_GLYPH[item.myAssignment.status]} ${ASSIGNMENT_LABEL[item.myAssignment.status]}`
      : null,
  ].filter(Boolean);
  return `**${missionHeadline(item.number, item.title)}**\n${facts.join(` ${GLYPH.dot} `)}`;
}

export async function openListPayload(
  h: HandlerContext,
  type: MissionType | null,
  offset: number,
): Promise<ReplyPayload> {
  const page = await missions.listOpenMissions(h.ctx, {
    type: type ?? undefined,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const filterValue = type ?? ALL_TYPES;
  const components: NonNullable<ReplyPayload['components']> = [
    row(
      stringSelect(customId(MISSIONS_NS, 'filter'), 'Filter by type', [
        { label: 'ALL TYPES', value: ALL_TYPES, default: filterValue === ALL_TYPES },
        ...missions.MISSION_TYPES.map((value) => ({
          label: TYPE_LABEL[value],
          value,
          default: filterValue === value,
        })),
      ]),
    ),
  ];
  if (page.items.length > 0) {
    components.push(
      row(
        stringSelect(
          customId(MISSIONS_NS, 'open'),
          'Open a mission',
          page.items.map(selectOptionFor),
        ),
      ),
    );
    const accept = page.items
      .filter(canAcceptFromList)
      .map((item) =>
        button(`Accept ${item.number}`, missions.missionAcceptCustomId(item.id), 'primary'),
      );
    if (accept.length > 0) components.push(row(...accept));
  }
  if (page.total > LIST_PAGE_SIZE) {
    const previous = Math.max(0, page.offset - LIST_PAGE_SIZE);
    const next = page.offset + LIST_PAGE_SIZE;
    components.push(
      row(
        button(
          'Previous',
          customId(MISSIONS_NS, 'list', filterValue, previous),
          'secondary',
          page.offset === 0,
        ),
        button(
          'Next',
          customId(MISSIONS_NS, 'list', filterValue, next),
          'secondary',
          next >= page.total,
        ),
      ),
    );
  }
  const shownTo = Math.min(page.offset + page.items.length, page.total);
  return {
    embeds: [
      panel({
        kicker: 'JVLN MISSIONS',
        title: type ? `Open missions ${GLYPH.dot} ${TYPE_LABEL[type]}` : 'Open missions',
        description:
          page.items.length > 0
            ? page.items.map(openLine).join('\n\n')
            : type
              ? 'No open missions of this type right now.'
              : 'No open missions right now. New ones are announced in the missions channel.',
        footer:
          page.total > 0
            ? `${page.offset + 1}–${shownTo} of ${page.total} ${GLYPH.dot} Verified missions become evidence on your record.`
            : undefined,
      }),
    ],
    components,
    ephemeral: true,
  };
}

// ── Own missions ────────────────────────────────────────────────────────────

const SCOPE_LABEL: Record<MineScope, string> = {
  active: 'ACTIVE',
  completed: 'COMPLETED',
  all: 'ALL',
};

function mineLine(item: missions.MyMissionItem): string {
  const { mission, assignment } = item;
  const facts = [
    `${ASSIGNMENT_GLYPH[assignment.status]} ${ASSIGNMENT_LABEL[assignment.status]}`,
    assignment.teamKey ? `team \`${assignment.teamKey}\`` : null,
    assignment.dueAt && showsDueDate(assignment.status)
      ? `due ${discordTime(assignment.dueAt, 'R')}`
      : null,
    assignment.attempts > 0
      ? `attempt ${assignment.attempts}/${missions.MAX_SUBMISSION_ATTEMPTS}`
      : null,
  ].filter(Boolean);
  return `**${missionHeadline(mission.number, mission.title)}**\n${facts.join(` ${GLYPH.dot} `)}`;
}

export async function minePayload(h: HandlerContext, scope: MineScope): Promise<ReplyPayload> {
  const items = await missions.listMyMissions(h.ctx, { scope });
  const shown = items.slice(0, MINE_SHOWN);
  const components: NonNullable<ReplyPayload['components']> = [
    row(
      stringSelect(
        customId(MISSIONS_NS, 'mine'),
        'Show',
        MINE_SCOPES.map((value) => ({
          label: SCOPE_LABEL[value],
          value,
          default: value === scope,
        })),
      ),
    ),
  ];
  if (items.length > 0) {
    components.push(
      row(
        stringSelect(
          customId(MISSIONS_NS, 'open'),
          'Open a mission',
          items.slice(0, LIMITS.selectOptions).map(({ mission }) => selectOptionFor(mission)),
        ),
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: 'JVLN MISSIONS',
        title: `Your missions ${GLYPH.dot} ${SCOPE_LABEL[scope]}`,
        description:
          shown.length > 0
            ? shown.map(mineLine).join('\n\n')
            : scope === 'completed'
              ? 'No verified missions yet.'
              : 'Nothing in progress. `/mission list` shows open missions.',
        footer:
          items.length > shown.length
            ? `Showing ${shown.length} of ${items.length}. The dashboard lists all.`
            : undefined,
      }),
    ],
    components,
    ephemeral: true,
  };
}

// ── Mission detail ──────────────────────────────────────────────────────────

function memberButtons(detail: missions.MissionDetail): APIButtonComponent[] {
  const { mission, myAssignment: own } = detail;
  const acceptId = missions.missionAcceptCustomId(mission.id);
  if (!own) {
    const takeable =
      mission.status === 'open' &&
      mission.selfAssignable &&
      mission.type !== 'team' &&
      detail.slotsLeft !== 0;
    return takeable ? [button('Accept', acceptId, 'primary')] : [];
  }
  const buttons: APIButtonComponent[] = [];
  if (missions.canTransitionAssignment(own.status, 'accepted'))
    buttons.push(button('Accept', acceptId, 'primary'));
  const submittable =
    own.status !== 'assigned' &&
    missions.canTransitionAssignment(own.status, 'submitted') &&
    own.attempts < missions.MAX_SUBMISSION_ATTEMPTS;
  if (submittable)
    buttons.push(
      button(
        own.status === 'rejected' ? 'Resubmit' : 'Submit',
        customId(MISSIONS_NS, 'submit', mission.id),
        'primary',
      ),
    );
  if (missions.canTransitionAssignment(own.status, 'abandoned'))
    buttons.push(button('Abandon', customId(MISSIONS_NS, 'abandon', mission.id), 'danger'));
  return buttons;
}

/** Submissions of this mission awaiting review, as the queue counts them: a team once. */
export function awaitingUnits(assignments: readonly missions.StaffAssignmentView[]): number {
  const units = new Set(
    assignments
      .filter((assignment) => assignment.status === 'submitted')
      .map((assignment) => (assignment.teamKey ? `team:${assignment.teamKey}` : assignment.id)),
  );
  return units.size;
}

function staffButtons(h: HandlerContext, detail: missions.MissionDetail): APIButtonComponent[] {
  const { mission } = detail;
  const id = mission.id;
  const buttons: APIButtonComponent[] = [];
  if (can(h.ctx, 'canManageMissions')) {
    if (mission.status === 'draft')
      buttons.push(button('Publish', customId(MISSIONS_NS, 'publish', id), 'success'));
    if (mission.status === 'open') {
      buttons.push(button('Assign', customId(MISSIONS_NS, 'assign', id), 'success'));
      buttons.push(button('Close', customId(MISSIONS_NS, 'close', id)));
    }
    if (mission.status === 'closed')
      buttons.push(button('Reopen', customId(MISSIONS_NS, 'reopen', id)));
    if (mission.status !== 'archived') {
      buttons.push(button('Edit', customId(MISSIONS_NS, 'edit', id)));
      buttons.push(button('Settings', customId(MISSIONS_NS, 'settings', id)));
    }
    if (missions.canTransitionMission(mission.status, 'archived'))
      buttons.push(button('Archive', customId(MISSIONS_NS, 'archive', id), 'danger'));
  }
  const awaiting = awaitingUnits(detail.assignments ?? []);
  if (awaiting > 0 && can(h.ctx, 'canVerifyMissions'))
    buttons.push(button(`Review queue (${awaiting})`, missionReviewId(id)));
  const url = dashboardMissionUrl(h.ctx.config.publicUrl, mission.id);
  if (url && buttons.length > 0) buttons.push(linkButton('Dashboard', url));
  return buttons;
}

/** Discord holds at most five buttons per row. */
export const BUTTONS_PER_ROW = 5;

export function buttonRows(
  buttons: readonly APIButtonComponent[],
): NonNullable<ReplyPayload['components']> {
  const rows: NonNullable<ReplyPayload['components']> = [];
  for (let start = 0; start < buttons.length; start += BUTTONS_PER_ROW)
    rows.push(row(...buttons.slice(start, start + BUTTONS_PER_ROW)));
  return rows;
}

function rosterLine(assignments: readonly missions.StaffAssignmentView[]): string {
  if (assignments.length === 0) return 'Nobody assigned yet.';
  const counts = new Map<missions.AssignmentStatus, number>();
  for (const assignment of assignments)
    counts.set(assignment.status, (counts.get(assignment.status) ?? 0) + 1);
  return [...counts.entries()]
    .map(([status, total]) => `${total} ${ASSIGNMENT_LABEL[status].toLowerCase()}`)
    .join(` ${GLYPH.dot} `);
}

/** Mission detail for the viewer: facts, their own assignment, and the actions they can take. */
export async function detailPayload(
  h: HandlerContext,
  missionId: string,
  notice?: APIEmbed,
): Promise<ReplyPayload> {
  const detail = await missions.getMissionDetail(h.ctx, { missionId });
  const { mission } = detail;
  const embed = missionEmbed({
    number: mission.number,
    title: mission.title,
    brief: mission.brief,
    type: mission.type,
    status: mission.status,
    facetLabel: await facetLabelOf(h, mission.facetKey),
    evidenceRequired: mission.evidenceRequired,
    deadlineAt: mission.deadlineAt,
    durationHours: mission.durationHours,
    slots: slotsOf(detail.slotsLeft, mission.maxAssignees),
    rewardTitle: rewardTitle(mission.reward),
    rewardNote: mission.rewardNote,
  });
  const fields = [...(embed.fields ?? [])];
  if (detail.myAssignment) fields.push(ownAssignmentField(detail.myAssignment));
  if (detail.assignments) fields.push(field('Roster (staff)', rosterLine(detail.assignments)));
  embed.fields = fields;
  const components = [...buttonRows(memberButtons(detail)), ...buttonRows(staffButtons(h, detail))];
  return {
    embeds: notice ? [notice, embed] : [embed],
    components,
    ephemeral: true,
  };
}
