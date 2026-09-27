import type { trials } from '@jave/core';
import { COLORS } from '../../../ui/theme';

type TrialStatus = trials.TrialStatus;
type ParticipantStatus = trials.StaffParticipantView['status'];
type TrialOutcome = trials.TrialOutcome;

export const STATUS_LABEL: Record<TrialStatus, string> = {
  draft: 'DRAFT',
  recruiting: 'RECRUITING',
  teams_assigned: 'TEAMS ASSIGNED',
  active: 'LIVE',
  evaluating: 'IN EVALUATION',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export const STATUS_COLOR: Record<TrialStatus, number> = {
  draft: COLORS.steel,
  recruiting: COLORS.chrome,
  teams_assigned: COLORS.base,
  active: COLORS.info,
  evaluating: COLORS.base,
  completed: COLORS.success,
  cancelled: COLORS.danger,
};

export const PARTICIPANT_LABEL: Record<ParticipantStatus, string> = {
  applied: 'APPLIED — awaiting selection',
  selected: 'SELECTED',
  waitlisted: 'WAITLISTED',
  withdrawn: 'WITHDRAWN',
  removed: 'REMOVED — no longer eligible',
};

export const OUTCOME_LABEL: Record<TrialOutcome, string> = {
  distinction: 'DISTINCTION',
  pass: 'PASS',
  fail: 'NOT PASSED',
  incomplete: 'INCOMPLETE',
};

export const OUTCOME_COLOR: Record<TrialOutcome, number> = {
  distinction: COLORS.chrome,
  pass: COLORS.success,
  fail: COLORS.steel,
  incomplete: COLORS.warning,
};

/** Trials a member acts on in Discord: not drafts, not finished ones. */
export const ONGOING_STATUSES: readonly TrialStatus[] = [
  'recruiting',
  'teams_assigned',
  'active',
  'evaluating',
];

export function categoryLabel(category: string): string {
  return category.toUpperCase();
}

const SCORE_DIGITS = 2;
/** The rubric scale (core validates every score against it). */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

export function formatScore(score: number | null): string {
  return score === null ? '—' : `${score.toFixed(SCORE_DIGITS)} / ${SCORE_MAX}`;
}
