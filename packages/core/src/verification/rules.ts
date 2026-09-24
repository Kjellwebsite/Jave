import { DAY } from '../kernel/clock';
import { InvalidStateError } from '../kernel/errors';
import { formatNumber } from '../kernel/ids';
import type { VerificationStatus } from './types';

/** Pending and in-review verifications expire this long after the request. */
export const VERIFICATION_EXPIRY_DAYS = 30;
/** New + existing evidence items attached to one request. */
export const MAX_EVIDENCE_PER_VERIFICATION = 10;
/** Open (pending / in-review) self-requested verifications a member may hold at once. */
export const MAX_OPEN_VERIFICATIONS_PER_MEMBER = 10;

export const OPEN_STATUSES = [
  'pending',
  'in_review',
] as const satisfies readonly VerificationStatus[];

const REFERENCE_PREFIX = 'VER';

/**
 * State machine.
 *   pending   → in_review | approved | rejected | expired
 *   in_review → pending (unassigned) | approved | rejected | expired
 *   approved  → revoked
 *   rejected, revoked, expired are terminal.
 */
const TRANSITIONS: Readonly<Record<VerificationStatus, readonly VerificationStatus[]>> = {
  pending: ['in_review', 'approved', 'rejected', 'expired'],
  in_review: ['pending', 'approved', 'rejected', 'expired'],
  approved: ['revoked'],
  rejected: [],
  revoked: [],
  expired: [],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isOpen(status: VerificationStatus): boolean {
  return (OPEN_STATUSES as readonly VerificationStatus[]).includes(status);
}

/** Expiry is inclusive: at `expiresAt` the verification is already expired. */
export function isPastExpiry(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

export function computeExpiry(now: Date, days = VERIFICATION_EXPIRY_DAYS): Date {
  return new Date(now.getTime() + days * DAY);
}

export function verificationReference(number: number): string {
  return formatNumber(REFERENCE_PREFIX, number);
}

/**
 * Guard a transition. Throws a calm, specific InvalidStateError (and treats a
 * pending/in-review verification past its expiry as expired).
 */
export function assertTransition(
  verification: { status: VerificationStatus; expiresAt: Date | null; number: number },
  to: VerificationStatus,
  now: Date,
): void {
  const reference = verificationReference(verification.number);
  if (to !== 'expired' && isOpen(verification.status) && isPastExpiry(verification.expiresAt, now))
    throw new InvalidStateError(`${reference} has expired. Request a new verification.`);
  if (!canTransition(verification.status, to))
    throw new InvalidStateError(
      `${reference} is ${verification.status.replace('_', ' ')} and cannot move to ${to.replace('_', ' ')}.`,
    );
}

/** Guard actions that need an open (pending / in-review), unexpired verification. */
export function assertOpen(
  verification: { status: VerificationStatus; expiresAt: Date | null; number: number },
  now: Date,
): void {
  const reference = verificationReference(verification.number);
  if (!isOpen(verification.status))
    throw new InvalidStateError(
      `${reference} is already ${verification.status.replace('_', ' ')}.`,
    );
  if (isPastExpiry(verification.expiresAt, now))
    throw new InvalidStateError(`${reference} has expired. Request a new verification.`);
}

export type VerifierConflict = 'subject' | 'requester' | null;

/**
 * Two-person rule. A verifier may not be:
 *  - the subject (nobody verifies themselves), or
 *  - the staff member who opened the request on someone else's behalf.
 * A request the subject opened for themselves needs one independent verifier;
 * a staff-opened request therefore always involves two distinct staff members.
 * System actors (null user) are not people and never conflict.
 */
export function verifierConflict(input: {
  verifierUserId: string | null;
  subjectUserId: string;
  requestedByUserId: string | null;
}): VerifierConflict {
  if (input.verifierUserId === null) return null;
  if (input.verifierUserId === input.subjectUserId) return 'subject';
  if (
    input.requestedByUserId !== null &&
    input.requestedByUserId !== input.subjectUserId &&
    input.verifierUserId === input.requestedByUserId
  )
    return 'requester';
  return null;
}

export type OpenedBy = 'subject' | 'staff' | 'system';

export function openedBy(input: {
  requestedByUserId: string | null;
  subjectUserId: string;
}): OpenedBy {
  if (input.requestedByUserId === null) return 'system';
  return input.requestedByUserId === input.subjectUserId ? 'subject' : 'staff';
}

/** Normalized target keys: one open verification per key. */
export const targetKeys = {
  identity: (memberId: string) => `identity:${memberId}`,
  skill: (memberId: string, facetKey: string) => `skill:${memberId}:${facetKey}`,
  project: (projectId: string, memberId: string) => `project:${projectId}:${memberId}`,
  contribution: (contributionId: string) => `contribution:${contributionId}`,
  achievement: (memberAchievementId: string) => `achievement:${memberAchievementId}`,
  trial: (trialResultId: string) => `trial:${trialResultId}`,
} as const;
