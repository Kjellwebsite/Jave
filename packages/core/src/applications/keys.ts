/** Job types and dedupe keys for this module. One place, so cancel and enqueue always agree. */

export const APPLICATION_DRAFT_EXPIRY_JOB = 'applications.drafts.expire';
export const APPLICATION_REVIEW_REMINDER_JOB = 'applications.reviews.remind';
export const APPLICATION_INTERVIEW_REMINDER_JOB = 'applications.interview.remind';

/**
 * Keyed by interview time as well: a reminder that is already running when
 * the interview moves must not swallow the new one (dedupe covers running
 * jobs, cancellation only pending ones).
 */
export function interviewReminderKey(applicationId: string, interviewAt: Date): string {
  return `application:${applicationId}:interview-reminder:${interviewAt.toISOString()}`;
}

/** Cancel the pending reminder for the interview currently on record, if any. */
export function currentInterviewReminderKey(app: {
  id: string;
  interviewAt: Date | null;
}): string | null {
  return app.interviewAt ? interviewReminderKey(app.id, app.interviewAt) : null;
}

export function reviewCardKey(applicationId: string, revision: number): string {
  return `application:${applicationId}:review-card:${revision}`;
}
