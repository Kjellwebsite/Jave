import type { APIEmbed, APIEmbedField } from 'discord.js';
import { missions } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';

/** Custom-id namespace of every missions control (the core ACCEPT id shares it). */
export const MISSIONS_NS = 'missions';
/** Longest brief rendered in an embed (the card's brief is already cut shorter by core). */
export const BRIEF_PREVIEW_MAX = 3000;
export const SUBMISSION_PREVIEW_MAX = 1800;
const FEEDBACK_PREVIEW_MAX = 600;
const FACET_LABEL_MAX = 64;
const { REWARD_NOTE_MAX, TITLE_MAX } = missions;

export type MissionType = missions.MissionType;
export type MissionStatus = missions.MissionStatus;
export type AssignmentStatus = missions.AssignmentStatus;

export const TYPE_LABEL: Record<MissionType, string> = {
  individual: 'INDIVIDUAL',
  team: 'TEAM',
  research: 'RESEARCH',
  build: 'BUILD',
  social: 'SOCIAL',
  physical: 'PHYSICAL',
  strategy: 'STRATEGY',
  creative: 'CREATIVE',
};

export const STATUS_LABEL: Record<MissionStatus, string> = {
  draft: 'DRAFT',
  open: 'OPEN',
  closed: 'CLOSED',
  archived: 'ARCHIVED',
};

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  assigned: 'ASSIGNED',
  accepted: 'IN PROGRESS',
  submitted: 'AWAITING REVIEW',
  verified: 'VERIFIED',
  rejected: 'RETURNED',
  expired: 'EXPIRED',
  abandoned: 'ABANDONED',
};

export const ASSIGNMENT_GLYPH: Record<AssignmentStatus, string> = {
  assigned: GLYPH.bullet,
  accepted: GLYPH.bullet,
  submitted: GLYPH.claimed,
  verified: GLYPH.verified,
  rejected: GLYPH.cross,
  expired: GLYPH.unknown,
  abandoned: GLYPH.unknown,
};

const STATUS_COLOR: Record<MissionStatus, number> = {
  draft: COLORS.steel,
  open: COLORS.chrome,
  closed: COLORS.base,
  archived: COLORS.steel,
};

/** "M-0042 — Prototype sprint", escaped. */
export function missionHeadline(number: string, title: string): string {
  return `${number} — ${userText(title, TITLE_MAX)}`;
}

/** Slots for a mission whose cap is known (detail views). */
export function slotsOf(slotsLeft: number | null, maxAssignees: number | null): string {
  if (slotsLeft === null || maxAssignees === null) return 'Open';
  return slotsLeft === 0 ? 'Full' : `${slotsLeft} of ${maxAssignees} left`;
}

/** Slots on the public card, which only knows how many are left. */
function cardSlots(slotsLeft: number | null): string {
  if (slotsLeft === null) return 'Open';
  return slotsLeft === 0 ? 'Full' : `${slotsLeft} left`;
}

function deadlineText(deadlineAt: Date | null): string {
  return deadlineAt
    ? `${discordTime(deadlineAt, 'f')} (${discordTime(deadlineAt, 'R')})`
    : GLYPH.unknown;
}

function durationText(hours: number | null): string {
  return hours ? `${hours}h per assignment` : GLYPH.unknown;
}

/** Reward line: hidden reward achievements stay masked for non-staff (core decides). */
export function rewardTitle(reward: missions.MissionReward | null): string | null {
  if (!reward) return null;
  const rarity = reward.rarity.toUpperCase();
  return reward.hidden
    ? `HIDDEN ACHIEVEMENT ${GLYPH.dot} ${rarity}`
    : `${reward.title.toUpperCase()} ${GLYPH.dot} ${rarity}`;
}

function rewardText(title: string | null, note: string | null): string {
  const parts = [
    title ? userText(title, TITLE_MAX * 2) : null,
    note ? userText(note, REWARD_NOTE_MAX) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : GLYPH.unknown;
}

export interface MissionFacts {
  number: string;
  title: string;
  brief: string;
  type: MissionType;
  status: MissionStatus;
  facetLabel: string | null;
  evidenceRequired: boolean;
  deadlineAt: Date | null;
  durationHours: number | null;
  /** Pre-rendered: "3 of 10 left", "Full", "Open". */
  slots: string;
  rewardTitle: string | null;
  rewardNote: string | null;
}

export function missionEmbed(facts: MissionFacts): APIEmbed {
  return panel({
    kicker: `MISSION ${facts.number} ${GLYPH.dot} ${TYPE_LABEL[facts.type]} ${GLYPH.dot} ${STATUS_LABEL[facts.status]}`,
    title: userText(facts.title, TITLE_MAX),
    description: userText(facts.brief, BRIEF_PREVIEW_MAX),
    color: STATUS_COLOR[facts.status],
    fields: [
      field('Slots', facts.type === 'team' ? 'Teams formed by staff' : facts.slots, true),
      field('Deadline', deadlineText(facts.deadlineAt), true),
      field('Time limit', durationText(facts.durationHours), true),
      field('Evidence', facts.evidenceRequired ? 'Required — title and link' : 'Optional', true),
      field(
        'Capability',
        facts.facetLabel ? userText(facts.facetLabel, FACET_LABEL_MAX) : GLYPH.unknown,
        true,
      ),
      field('Reward', rewardText(facts.rewardTitle, facts.rewardNote), true),
    ],
  });
}

function cardFooter(card: missions.MissionCard): string {
  if (card.status === 'closed') return 'Closed to new assignments. Work in progress continues.';
  if (card.status === 'archived') return 'Archived.';
  if (card.acceptEnabled) return 'ACCEPT to start. Submit with /mission submit.';
  if (card.type === 'team') return 'Team mission. Staff form the teams.';
  return card.slotsLeft === 0 ? 'Every slot is taken.' : 'Assigned by staff.';
}

/** The public mission card, posted and refreshed by the Discord jobs. */
export function renderMissionCard(card: missions.MissionCard): MessagePayload {
  const embed = missionEmbed({
    number: card.number,
    title: card.title,
    brief: card.brief,
    type: card.type,
    status: card.status,
    facetLabel: card.facetLabel,
    evidenceRequired: card.evidenceRequired,
    deadlineAt: card.deadlineAt,
    durationHours: card.durationHours,
    slots: cardSlots(card.slotsLeft),
    rewardTitle: card.rewardTitle,
    rewardNote: card.rewardNote,
  });
  embed.footer = { text: cardFooter(card) };
  const buttons = [];
  if (card.acceptEnabled) buttons.push(button('Accept', card.acceptCustomId, 'primary'));
  if (card.status !== 'archived')
    buttons.push(button('Details', customId(MISSIONS_NS, 'view', card.missionId)));
  // An empty list removes the ACCEPT button from an edited card.
  return { embeds: [embed], components: buttons.length > 0 ? [row(...buttons)] : [] };
}

/** Assignment states still working toward their due date. */
const DUE_STATUSES: ReadonlySet<AssignmentStatus> = new Set(['assigned', 'accepted', 'rejected']);

/** Submitted work never expires, and finished work has no due date left to meet. */
export function showsDueDate(status: AssignmentStatus): boolean {
  return DUE_STATUSES.has(status);
}

/** The viewer's own assignment, as a field block. */
export function ownAssignmentField(own: missions.OwnAssignmentView): APIEmbedField {
  const lines = [`${ASSIGNMENT_GLYPH[own.status]} **${ASSIGNMENT_LABEL[own.status]}**`];
  if (own.teamKey) lines.push(`Team \`${own.teamKey}\``);
  if (own.dueAt && showsDueDate(own.status))
    lines.push(`Due ${discordTime(own.dueAt, 'f')} (${discordTime(own.dueAt, 'R')})`);
  if (own.attempts > 0)
    lines.push(`Attempt ${own.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}`);
  if (own.feedback && (own.status === 'rejected' || own.status === 'verified'))
    lines.push(`Feedback: ${userText(own.feedback, FEEDBACK_PREVIEW_MAX)}`);
  return field('Your assignment', lines.join('\n'));
}

/** A URL a link button can carry: Discord refuses the whole message over a longer one. */
export function linkableUrl(url: string): string | null {
  return url.length <= LIMITS.linkUrl ? url : null;
}

/**
 * Link to the mission in the dashboard (its review tab with `review`), when
 * a public URL is configured.
 */
export function dashboardMissionUrl(
  publicUrl: string | undefined,
  missionId: string,
  tab?: 'review',
): string | null {
  if (!publicUrl) return null;
  try {
    const url = new URL(`/missions/${encodeURIComponent(missionId)}`, publicUrl);
    if (tab) url.searchParams.set('tab', tab);
    return linkableUrl(url.toString());
  } catch {
    return null;
  }
}
