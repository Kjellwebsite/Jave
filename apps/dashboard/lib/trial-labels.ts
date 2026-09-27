/**
 * Human labels and status tones for the trials pages. Client-safe (no core
 * imports at runtime): the unions mirror `@jave/core` trials/adversarial types.
 */

export type TrialStatusKey =
  | 'draft'
  | 'recruiting'
  | 'teams_assigned'
  | 'active'
  | 'evaluating'
  | 'completed'
  | 'cancelled';

export type BadgeToneKey = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const TRIAL_STATUS_LABELS: Record<TrialStatusKey, string> = {
  draft: 'Draft',
  recruiting: 'Recruiting',
  teams_assigned: 'Teams set',
  active: 'Live',
  evaluating: 'Evaluating',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const TRIAL_STATUS_TONE: Record<TrialStatusKey, BadgeToneKey> = {
  draft: 'neutral',
  recruiting: 'info',
  teams_assigned: 'accent',
  active: 'success',
  evaluating: 'warning',
  completed: 'neutral',
  cancelled: 'danger',
};

/** The main line of the state machine (cancelled branches off any non-terminal state). */
export const TRIAL_TRACK: readonly TrialStatusKey[] = [
  'draft',
  'recruiting',
  'teams_assigned',
  'active',
  'evaluating',
  'completed',
];

export type ParticipantStatusKey = 'applied' | 'selected' | 'waitlisted' | 'withdrawn' | 'removed';

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatusKey, string> = {
  applied: 'Applied',
  selected: 'Selected',
  waitlisted: 'Waitlisted',
  withdrawn: 'Withdrawn',
  removed: 'Removed',
};

export const PARTICIPANT_STATUS_TONE: Record<ParticipantStatusKey, BadgeToneKey> = {
  applied: 'info',
  selected: 'success',
  waitlisted: 'neutral',
  withdrawn: 'neutral',
  removed: 'warning',
};

export type OutcomeKey = 'distinction' | 'pass' | 'fail' | 'incomplete';

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  distinction: 'Distinction',
  pass: 'Pass',
  fail: 'Not passed',
  incomplete: 'Incomplete',
};

export const OUTCOME_TONE: Record<OutcomeKey, BadgeToneKey> = {
  distinction: 'accent',
  pass: 'success',
  fail: 'neutral',
  incomplete: 'warning',
};

export const INCOMPLETE_REASON_LABELS = {
  no_submission: 'No submission',
  not_evaluated: 'Not evaluated',
} as const;

export const STRATEGY_LABELS = {
  balanced: 'Balanced — spread primary domains',
  random: 'Random',
} as const;

export type StrategyKey = keyof typeof STRATEGY_LABELS;

/** "build" → "Build", "crisis" → "Crisis". */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

const SCORE_DIGITS = 2;

/** "7.50" — scores are stored at two decimals on a 0–10 scale. */
export function scoreLabel(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : score.toFixed(SCORE_DIGITS);
}

// ─── Adversarial ─────────────────────────────────────────────────────────────

export type RoleStatusKey = 'planned' | 'briefed' | 'active' | 'concluded' | 'revealed' | 'aborted';

export const ROLE_STATUS_LABELS: Record<RoleStatusKey, string> = {
  planned: 'Planned',
  briefed: 'Briefed',
  active: 'Active',
  concluded: 'Concluded',
  revealed: 'Revealed',
  aborted: 'Stopped',
};

export const ROLE_STATUS_TONE: Record<RoleStatusKey, BadgeToneKey> = {
  planned: 'neutral',
  briefed: 'info',
  active: 'warning',
  concluded: 'accent',
  revealed: 'success',
  aborted: 'danger',
};

export type ObservationOutcomeKey = 'resisted' | 'detected' | 'reported' | 'partial' | 'failure';

export const OBSERVATION_TONE: Record<ObservationOutcomeKey, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  reported: 'success',
  detected: 'success',
  resisted: 'info',
  partial: 'warning',
  failure: 'danger',
};
