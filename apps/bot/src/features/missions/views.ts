import type { APIButtonComponent, APIEmbed } from 'discord.js';
import { can, missions } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { discordTime, plainText, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
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
  slotsOf,
  STATUS_LABEL,
  SUBMISSION_PREVIEW_MAX,
  TYPE_LABEL,
  type MissionType,
} from './render';

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

function canTakeFromList(item: missions.OpenMissionItem): boolean {
  return (
    item.myAssignment === null &&
    item.selfAssignable &&
    item.type !== 'team' &&
    item.slotsLeft !== 0
  );
}

function openLine(item: missions.OpenMissionItem): string {
  const facts = [
    `\`${TYPE_LABEL[item.type]}\``,
    item.type === 'team' ? 'teams by staff' : slotsOf(item.slotsLeft, item.maxAssignees).toLowerCase(),
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
      row(stringSelect(customId(MISSIONS_NS, 'open'), 'Open a mission', page.items.map(selectOptionFor))),
    );
    const accept = page.items
      .filter(canTakeFromList)
      .map((item) => button(`Accept ${item.number}`, missions.missionAcceptCustomId(item.id), 'primary'));
    if (accept.length > 0) components.push(row(...accept));
  }
  if (page.total > LIST_PAGE_SIZE) {
    const previous = Math.max(0, page.offset - LIST_PAGE_SIZE);
    const next = page.offset + LIST_PAGE_SIZE;
    components.push(
      row(
        button('Previous', customId(MISSIONS_NS, 'list', filterValue, previous), 'secondary', page.offset === 0),
        button('Next', customId(MISSIONS_NS, 'list', filterValue, next), 'secondary', next >= page.total),
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
    assignment.dueAt && assignment.status !== 'verified'
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
        MINE_SCOPES.map((value) => ({ label: SCOPE_LABEL[value], value, default: value === scope })),
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
        footer: items.length > shown.length ? `Showing ${shown.length} of ${items.length}. The dashboard lists all.` : undefined,
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
    buttons.push(button(own.status === 'rejected' ? 'Resubmit' : 'Submit', customId(MISSIONS_NS, 'submit', mission.id), 'primary'));
  if (missions.canTransitionAssignment(own.status, 'abandoned'))
    buttons.push(button('Abandon', customId(MISSIONS_NS, 'abandon', mission.id), 'danger'));
  return buttons;
}

function staffButtons(h: HandlerContext, detail: missions.MissionDetail): APIButtonComponent[] {
  const { mission } = detail;
  const buttons: APIButtonComponent[] = [];
  if (can(h.ctx, 'canManageMissions')) {
    const id = mission.id;
    if (mission.status === 'draft') buttons.push(button('Publish', customId(MISSIONS_NS, 'publish', id), 'success'));
    if (mission.status === 'open') {
      buttons.push(button('Assign', customId(MISSIONS_NS, 'assign', id)));
      buttons.push(button('Close', customId(MISSIONS_NS, 'close', id)));
    }
    if (mission.status === 'closed') buttons.push(button('Reopen', customId(MISSIONS_NS, 'reopen', id)));
    if (missions.canTransitionMission(mission.status, 'archived'))
      buttons.push(button('Archive', customId(MISSIONS_NS, 'archive', id), 'danger'));
  }
  const awaiting = detail.assignments?.filter((a) => a.status === 'submitted').length ?? 0;
  if (awaiting > 0 && can(h.ctx, 'canVerifyMissions'))
    buttons.push(button(`Review (${awaiting})`, customId(MISSIONS_NS, 'review', 0)));
  const url = dashboardMissionUrl(h.ctx.config.publicUrl, mission.id);
  if (url && buttons.length > 0) buttons.push(linkButton('Dashboard', url));
  return buttons;
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
  const components: NonNullable<ReplyPayload['components']> = [];
  const own = memberButtons(detail);
  if (own.length > 0) components.push(row(...own));
  const staff = staffButtons(h, detail);
  if (staff.length > 0) components.push(row(...staff));
  return {
    embeds: notice ? [notice, embed] : [embed],
    components,
    ephemeral: true,
  };
}

// ── Review queue ────────────────────────────────────────────────────────────

function evidenceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function reviewEmbed(item: missions.ReviewQueueItem, position: number, total: number): APIEmbed {
  const unit = item.teamKey
    ? `Team \`${item.teamKey}\` ${GLYPH.dot} ${item.members.map((m) => userText(m.displayName, 64)).join(', ')}`
    : item.members.map((m) => `${userText(m.displayName, 64)} ${GLYPH.dot} @${userText(m.handle, 64)}`).join(', ');
  const fields = [
    field(item.teamKey ? 'Team' : 'Member', unit),
    field('Submitted', item.submittedAt ? discordTime(item.submittedAt, 'R') : GLYPH.unknown, true),
    field('Attempt', `${item.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}`, true),
  ];
  if (item.evidenceTitle || item.evidenceUrl) {
    fields.push(
      field(
        'Evidence',
        [item.evidenceTitle ? userText(item.evidenceTitle, 200) : null, item.evidenceUrl ? userText(item.evidenceUrl, 300) : null]
          .filter(Boolean)
          .join('\n'),
      ),
    );
  }
  if (item.isOwn)
    fields.push(field('Not yours to review', 'You are part of this unit. Another reviewer must decide it.'));
  return panel({
    kicker: `REVIEW QUEUE ${GLYPH.dot} ${position} OF ${total}`,
    title: missionHeadline(item.missionNumber, item.missionTitle),
    description: item.submission ? userText(item.submission, SUBMISSION_PREVIEW_MAX) : 'No text submitted.',
    color: item.isOwn ? COLORS.steel : COLORS.chrome,
    fields,
  });
}

/** One submission from the review queue, oldest first, with VERIFY / REJECT. */
export async function reviewPayload(
  h: HandlerContext,
  requestedOffset: number,
  notice?: APIEmbed,
): Promise<ReplyPayload> {
  let page = await missions.listSubmissionsForReview(h.ctx, { limit: 1, offset: requestedOffset });
  if (page.items.length === 0 && page.total > 0)
    page = await missions.listSubmissionsForReview(h.ctx, { limit: 1, offset: page.total - 1 });
  const [item] = page.items;
  if (!item) {
    const clear = panel({
      kicker: 'REVIEW QUEUE',
      title: 'Queue clear',
      description: 'No submissions await review.',
      color: COLORS.success,
    });
    return { embeds: notice ? [notice, clear] : [clear], components: [], ephemeral: true };
  }
  const offset = page.offset;
  const buttons: APIButtonComponent[] = [];
  if (!item.isOwn) {
    buttons.push(button('Verify', customId(MISSIONS_NS, 'verify', item.assignmentId, offset), 'success'));
    buttons.push(button('Reject', customId(MISSIONS_NS, 'reject', item.assignmentId, offset), 'danger'));
  }
  const url = evidenceUrl(item.evidenceUrl);
  if (url) buttons.push(linkButton('Open evidence', url));
  const navigation = [
    button('Previous', customId(MISSIONS_NS, 'review', Math.max(0, offset - 1)), 'secondary', offset === 0),
    button('Next', customId(MISSIONS_NS, 'review', offset + 1), 'secondary', offset + 1 >= page.total),
  ];
  const embed = reviewEmbed(item, offset + 1, page.total);
  return {
    embeds: notice ? [notice, embed] : [embed],
    components: [row(...buttons), row(...navigation)].filter((r) => r.components.length > 0),
    ephemeral: true,
  };
}

export { STATUS_LABEL };
