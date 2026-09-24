import type { applicationRecommendation, applicationStatus } from '@jave/database';
import { InvalidStateError } from '../kernel/errors';

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
export type ApplicationRecommendation = (typeof applicationRecommendation.enumValues)[number];

/**
 * The application lifecycle as data.
 *
 *   DRAFT → SUBMITTED → REVIEW → INTERVIEW → ACCEPTED | REJECTED
 *   SUBMITTED → REJECTED   (fast path; still bound by minReviewsBeforeDecision)
 *   REVIEW → ACCEPTED | REJECTED   (an interview is optional)
 *   any open state → WITHDRAWN
 *
 * ACCEPTED, REJECTED and WITHDRAWN are terminal. Acceptance always passes
 * through REVIEW, so somebody has looked at every accepted application.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['review', 'rejected', 'withdrawn'],
  review: ['interview', 'accepted', 'rejected', 'withdrawn'],
  interview: ['accepted', 'rejected', 'withdrawn'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

/** States covered by the one-open-application-per-user index. */
export const OPEN_STATUSES: readonly ApplicationStatus[] = [
  'draft',
  'submitted',
  'review',
  'interview',
];

/** Submitted and not yet decided: the states staff work on. */
export const IN_FLIGHT_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'review',
  'interview',
];

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to);
}

export function isOpenStatus(status: ApplicationStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isTerminalStatus(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}

/** Throws InvalidStateError with a user-safe message when `from → to` is not allowed. */
export function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (canTransition(from, to)) return;
  throw new InvalidStateError(
    `This application is ${from.toUpperCase()} and cannot move to ${to.toUpperCase()}.`,
    { from, to },
  );
}

/** Staff actions a review card offers for a given state. */
export type StaffAction = 'start_review' | 'review' | 'schedule_interview' | 'accept' | 'reject';

const STAFF_ACTIONS: Readonly<Record<ApplicationStatus, readonly StaffAction[]>> = {
  draft: [],
  submitted: ['start_review', 'review', 'reject'],
  review: ['review', 'schedule_interview', 'accept', 'reject'],
  interview: ['review', 'schedule_interview', 'accept', 'reject'],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

export function staffActionsFor(status: ApplicationStatus): readonly StaffAction[] {
  return STAFF_ACTIONS[status];
}
