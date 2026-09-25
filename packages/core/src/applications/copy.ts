import type { OrgRole } from '../permissions/roles';

/**
 * User-facing notification copy for the application workflow. Concise, calm,
 * uppercase titles. Applicant copy never carries internal reasons or names
 * of reviewers.
 */

export interface NotificationCopy {
  title: string;
  body: string;
}

/** `2026-03-05 14:00 UTC` — surfaces render local time from `data.interviewAt`. */
export function formatUtc(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function withMessage(body: string, message: string | null | undefined): string {
  return message ? `${body}\n\n${message}` : body;
}

export const applicantCopy = {
  submitted: (number: string): NotificationCopy => ({
    title: 'APPLICATION SUBMITTED',
    body: `${number} is in the review queue. Updates arrive here.`,
  }),
  inReview: (number: string): NotificationCopy => ({
    title: 'APPLICATION IN REVIEW',
    body: `${number} is being reviewed.`,
  }),
  interviewScheduled: (
    number: string,
    at: Date,
    rescheduled: boolean,
    message: string | null,
  ): NotificationCopy => ({
    title: rescheduled ? 'INTERVIEW MOVED' : 'INTERVIEW SCHEDULED',
    body: withMessage(`${number} — interview at ${formatUtc(at)}.`, message),
  }),
  interviewReminder: (number: string, at: Date): NotificationCopy => ({
    title: 'INTERVIEW IN 1 HOUR',
    body: `${number} — interview at ${formatUtc(at)}.`,
  }),
  accepted: (number: string, role: OrgRole | null, message: string | null): NotificationCopy => ({
    title: 'APPLICATION ACCEPTED',
    body: withMessage(
      role ? `${number} — accepted. You are now ${role.toUpperCase()}.` : `${number} — accepted.`,
      message,
    ),
  }),
  rejected: (
    number: string,
    reapplyFrom: Date | null,
    message: string | null,
  ): NotificationCopy => ({
    title: 'APPLICATION NOT ACCEPTED',
    body: withMessage(
      reapplyFrom
        ? `${number} — not accepted this time. You can apply again from ${formatDay(reapplyFrom)}.`
        : `${number} — not accepted this time. You can apply again.`,
      message,
    ),
  }),
  draftExpired: (number: string, days: number): NotificationCopy => ({
    title: 'DRAFT CLOSED',
    body: `${number} had no edits for ${days} days and was closed. Start a new one any time.`,
  }),
};

export const reviewerCopy = {
  received: (number: string, domainLabel: string | null): NotificationCopy => ({
    title: 'APPLICATION RECEIVED',
    body: domainLabel
      ? `${number} — ${domainLabel.toUpperCase()}. Awaiting review.`
      : `${number}. Awaiting review.`,
  }),
  waiting: (number: string, hours: number): NotificationCopy => ({
    title: 'APPLICATION WAITING',
    body: `${number} has waited more than ${hours}h for review.`,
  }),
  assigned: (number: string): NotificationCopy => ({
    title: 'APPLICATION ASSIGNED',
    body: `${number} is assigned to you for review.`,
  }),
  assignmentWaiting: (number: string, hours: number): NotificationCopy => ({
    title: 'REVIEW PENDING',
    body: `${number} has been assigned to you for more than ${hours}h without a recommendation.`,
  }),
  reviewerUnavailable: (number: string, hours: number): NotificationCopy => ({
    title: 'REVIEW STALLED',
    body: `${number} has had no recommendation for more than ${hours}h and its reviewer can no longer review. Reassign it.`,
  }),
};
