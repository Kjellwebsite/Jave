import { missionAssignmentStatus, missionStatus, missionType } from '@jave/database';
import { DAY, HOUR } from '../kernel/clock';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { formatNumber } from '../kernel/ids';

/**
 * Pure mission rules: state machines, due-date resolution, slots and
 * reminder timing. No I/O here.
 */

export const MISSION_TYPES = missionType.enumValues;
export type MissionType = (typeof MISSION_TYPES)[number];
export const MISSION_STATUSES = missionStatus.enumValues;
export type MissionStatus = (typeof MISSION_STATUSES)[number];
export const ASSIGNMENT_STATUSES = missionAssignmentStatus.enumValues;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * Mission lifecycle:
 *   draft ──publish──► open ──close──► closed ──archive──► archived
 *     │                  ▲               │
 *     └──archive──►      └────reopen─────┘
 */
export const MISSION_TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  draft: ['open', 'archived'],
  open: ['closed'],
  closed: ['open', 'archived'],
  archived: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

/**
 * Assignment lifecycle:
 *   assigned ──accept──► accepted ──submit──► submitted ──verify──► verified
 *      │                    │                    │
 *      │                    │                    └──reject──► rejected ──resubmit──► submitted
 *      └──── abandon / expire (from assigned, accepted or rejected) ────► abandoned / expired
 * Self-assignment starts at accepted.
 */
export const ASSIGNMENT_TRANSITIONS: Readonly<
  Record<AssignmentStatus, readonly AssignmentStatus[]>
> = {
  assigned: ['accepted', 'submitted', 'abandoned', 'expired'],
  accepted: ['submitted', 'abandoned', 'expired'],
  submitted: ['verified', 'rejected'],
  rejected: ['submitted', 'abandoned', 'expired'],
  verified: [],
  abandoned: ['assigned'],
  expired: ['assigned'],
};

export function canTransitionAssignment(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

/** Still in progress: can be worked on, abandoned, or expire. */
export const WORKING_STATUSES = [
  'assigned',
  'accepted',
  'rejected',
] as const satisfies readonly AssignmentStatus[];
/** A member may send a submission from these states (the owner must have accepted). */
export const SUBMITTABLE_STATUSES = [
  'accepted',
  'rejected',
] as const satisfies readonly AssignmentStatus[];
/** Occupy a slot against maxAssignees. */
export const SLOT_STATUSES = [
  'assigned',
  'accepted',
  'submitted',
  'rejected',
  'verified',
] as const satisfies readonly AssignmentStatus[];
/** Staff may re-assign a member whose previous attempt ended this way. */
export const REASSIGNABLE_STATUSES = [
  'abandoned',
  'expired',
] as const satisfies readonly AssignmentStatus[];

export function isWorking(status: AssignmentStatus): boolean {
  return (WORKING_STATUSES as readonly AssignmentStatus[]).includes(status);
}

/** Submissions allowed per assignment (first submission plus resubmissions after rejection). */
export const MAX_SUBMISSION_ATTEMPTS = 3;
/** Longest per-assignment time limit. */
export const MAX_DURATION_HOURS = 90 * 24;
/** Deadlines further out than this are almost certainly typos. */
export const MAX_DEADLINE_HORIZON_MS = 730 * DAY;
/** Deadline reminders go out this long before an assignment is due. */
export const REMINDER_LEAD_MS = 24 * HOUR;

export function formatMissionNumber(value: number): string {
  return formatNumber('M', value);
}

export interface DueDateInput {
  now: Date;
  explicitDueAt: Date | null;
  durationHours: number | null;
  deadlineAt: Date | null;
}

/**
 * When an assignment is due: an explicit date wins, else now + duration,
 * else the mission deadline. Never later than the mission deadline, and
 * never for a mission whose deadline already passed.
 */
export function resolveDueAt(input: DueDateInput): Date | null {
  const { now, explicitDueAt, durationHours, deadlineAt } = input;
  if (isPast(deadlineAt, now)) throw new InvalidStateError('The mission deadline has passed.');
  if (explicitDueAt) {
    if (explicitDueAt.getTime() <= now.getTime())
      throw new ValidationError('dueAt: must be in the future');
    if (deadlineAt && explicitDueAt.getTime() > deadlineAt.getTime())
      throw new ValidationError('dueAt: must not be after the mission deadline');
    return explicitDueAt;
  }
  if (durationHours) {
    const byDuration = new Date(now.getTime() + durationHours * HOUR);
    return deadlineAt && deadlineAt.getTime() < byDuration.getTime() ? deadlineAt : byDuration;
  }
  return deadlineAt;
}

/** A mission deadline must lie in the future and within the planning horizon. */
export function assertValidDeadline(deadlineAt: Date | null | undefined, now: Date): void {
  if (!deadlineAt) return;
  if (deadlineAt.getTime() <= now.getTime())
    throw new ValidationError('deadlineAt: must be in the future');
  if (deadlineAt.getTime() > now.getTime() + MAX_DEADLINE_HORIZON_MS)
    throw new ValidationError('deadlineAt: too far in the future');
}

export function isPast(moment: Date | null, now: Date): boolean {
  return moment !== null && moment.getTime() <= now.getTime();
}

/** Remaining slots, or null when the mission has no cap. */
export function remainingSlots(maxAssignees: number | null, taken: number): number | null {
  return maxAssignees === null ? null : Math.max(0, maxAssignees - taken);
}

export interface ReminderCandidate {
  status: AssignmentStatus;
  assignedAt: Date;
  dueAt: Date | null;
  reminderDueAt: Date | null;
  attempts: number;
}

/**
 * A deadline reminder is due when the assignment is still being worked on,
 * falls due within the lead window, has not been reminded for this due date,
 * and was not created inside the window (a 12-hour assignment needs no
 * "24 hours left" message the moment it is created).
 */
export function shouldRemind(candidate: ReminderCandidate, now: Date): boolean {
  const { dueAt } = candidate;
  if (!dueAt || !isWorking(candidate.status)) return false;
  if (candidate.status === 'rejected' && candidate.attempts >= MAX_SUBMISSION_ATTEMPTS)
    return false;
  const untilDue = dueAt.getTime() - now.getTime();
  if (untilDue <= 0 || untilDue > REMINDER_LEAD_MS) return false;
  if (dueAt.getTime() - candidate.assignedAt.getTime() <= REMINDER_LEAD_MS) return false;
  return candidate.reminderDueAt?.getTime() !== dueAt.getTime();
}

/** Whole hours until `dueAt`, rounded up, never below one. */
export function hoursLeft(dueAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((dueAt.getTime() - now.getTime()) / HOUR));
}
