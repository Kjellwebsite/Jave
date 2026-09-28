import type { missions } from '@jave/core';
import type { BadgeTone } from '@jave/ui';

/** Human labels and tones for mission enums (tables, badges, filters). */
export const MISSION_TYPE_LABELS = {
  individual: 'Individual',
  team: 'Team',
  research: 'Research',
  build: 'Build',
  social: 'Social',
  physical: 'Physical',
  strategy: 'Strategy',
  creative: 'Creative',
} as const;

export type MissionTypeKey = keyof typeof MISSION_TYPE_LABELS;

export const MISSION_STATUS_LABELS = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  archived: 'Archived',
} as const;

export type MissionStatusKey = keyof typeof MISSION_STATUS_LABELS;

/** Open is the expected state (quiet); drafts and closures stand out. */
export const MISSION_STATUS_TONE: Record<MissionStatusKey, BadgeTone> = {
  draft: 'info',
  open: 'success',
  closed: 'neutral',
  archived: 'neutral',
};

export const ASSIGNMENT_STATUS_LABELS = {
  assigned: 'Assigned',
  accepted: 'In progress',
  submitted: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Returned',
  expired: 'Expired',
  abandoned: 'Abandoned',
} as const;

export type AssignmentStatusKey = keyof typeof ASSIGNMENT_STATUS_LABELS;

export const ASSIGNMENT_STATUS_TONE: Record<AssignmentStatusKey, BadgeTone> = {
  assigned: 'info',
  accepted: 'neutral',
  submitted: 'warning',
  verified: 'success',
  rejected: 'danger',
  expired: 'neutral',
  abandoned: 'neutral',
};

/** Assignment states still working toward their due date. */
const DUE_STATUSES: ReadonlySet<AssignmentStatusKey> = new Set([
  'assigned',
  'accepted',
  'rejected',
]);

/**
 * Whether an assignment's due date still means anything: submitted work
 * never expires, and finished work has no due date left to meet.
 */
export function showsDueDate(status: AssignmentStatusKey): boolean {
  return DUE_STATUSES.has(status);
}

/** Missions staff list tabs, in order. */
export const MISSION_TABS = [
  'open',
  'draft',
  'closed',
  'archived',
] as const satisfies readonly MissionStatusKey[];

/** "3 of 10" / "3 · no cap": how many hold the mission (staff tables). */
export function holdingLabel(holding: number, maxAssignees: number | null): string {
  return maxAssignees === null ? `${holding} · no cap` : `${holding} of ${maxAssignees}`;
}

/** "7 of 10 left", "Full · 10 of 10", "No cap · 3 taking part": the slots as anyone reads them. */
export function slotsLabel(holding: number, maxAssignees: number | null): string {
  if (maxAssignees === null) return `No cap · ${holding} taking part`;
  if (holding >= maxAssignees) return `Full · ${holding} of ${maxAssignees}`;
  return `${maxAssignees - holding} of ${maxAssignees} left`;
}

/** "Builder · rare"; a reward hidden from the viewer shows only its rarity. */
export function rewardLabel(reward: missions.MissionReward | null): string {
  if (!reward) return '—';
  return reward.hidden
    ? `Hidden achievement · ${reward.rarity}`
    : `${reward.title} · ${reward.rarity}`;
}
