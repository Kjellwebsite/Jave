import { InvalidStateError } from '../kernel/errors';
import { type TrialStatus, trialRef } from './constants';

/**
 * Trial lifecycle:
 *
 *   draft → recruiting → teams_assigned → active → evaluating → completed
 *     └──────────┴──────────────┴────────────┴──────────┴──→ cancelled
 *
 * teams_assigned → teams_assigned is a reshuffle before the start.
 * completed and cancelled are terminal.
 */
export const TRIAL_TRANSITIONS: Readonly<Record<TrialStatus, readonly TrialStatus[]>> = {
  draft: ['recruiting', 'cancelled'],
  recruiting: ['teams_assigned', 'cancelled'],
  teams_assigned: ['teams_assigned', 'active', 'cancelled'],
  active: ['evaluating', 'cancelled'],
  evaluating: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly TrialStatus[] = ['completed', 'cancelled'];

/** Statuses in which the trial's content (brief, rubric, sizing) may still be edited. */
export const EDITABLE_STATUSES: readonly TrialStatus[] = ['draft', 'recruiting', 'teams_assigned'];

/** Statuses visible to non-staff members. */
export const MEMBER_VISIBLE_STATUSES: readonly TrialStatus[] = [
  'recruiting',
  'teams_assigned',
  'active',
  'evaluating',
  'completed',
];

export function canTransition(from: TrialStatus, to: TrialStatus): boolean {
  return TRIAL_TRANSITIONS[from].includes(to);
}

/** Throws InvalidStateError unless `trial` may move to `to`. */
export function assertTransition(
  trial: { number: number; status: TrialStatus },
  to: TrialStatus,
  action: string,
): void {
  if (!canTransition(trial.status, to)) {
    throw new InvalidStateError(
      `${trialRef(trial)} is ${trial.status.replace('_', ' ')} — cannot ${action}.`,
      { status: trial.status, to },
    );
  }
}

/** Throws InvalidStateError unless the trial is in one of `allowed`. */
export function assertStatus(
  trial: { number: number; status: TrialStatus },
  allowed: readonly TrialStatus[],
  action: string,
): void {
  if (!allowed.includes(trial.status)) {
    throw new InvalidStateError(
      `${trialRef(trial)} is ${trial.status.replace('_', ' ')} — cannot ${action}.`,
      { status: trial.status, allowed },
    );
  }
}
