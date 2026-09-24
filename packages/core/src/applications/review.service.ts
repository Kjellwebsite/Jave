import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { applicationReviews } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { cancelJob, enqueueJob } from '../jobs/queue';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { notify } from '../notifications/notifications.service';
import { actorUserId } from '../permissions/actor';
import { authorize, requireUser } from '../permissions/authorize';
import { applicantCopy, reviewerCopy } from './copy';
import { assertEligibleReviewer, assertNotOwnApplication } from './guards';
import {
  APPLICATION_INTERVIEW_REMINDER_JOB,
  currentInterviewReminderKey,
  interviewReminderKey,
} from './keys';
import {
  type ApplicationRecord,
  applicantMemberId,
  applicationNumber,
  loadSubmittedApplication,
  refreshReviewCard,
  transitionApplication,
  updateApplication,
} from './repository';
import { reviewSchema, scheduleInterviewSchema, startReviewSchema } from './schemas';
import {
  type ApplicationRecommendation,
  type ApplicationStatus,
  IN_FLIGHT_STATUSES,
} from './state-machine';

/** Review-stage staff actions: claim/assign, review, schedule interviews. */

/** Interviews must be at least this far ahead and at most this far out. */
export const MIN_INTERVIEW_LEAD_MS = 15 * MINUTE;
export const MAX_INTERVIEW_HORIZON_MS = 90 * DAY;
/** The applicant is reminded this long before the interview. */
export const INTERVIEW_REMINDER_LEAD_MS = HOUR;

export interface ApplicationStaffSummary {
  id: string;
  number: string;
  status: ApplicationStatus;
  assignedReviewerUserId: string | null;
  interviewAt: Date | null;
  decidedAt: Date | null;
}

export function toStaffSummary(app: ApplicationRecord): ApplicationStaffSummary {
  return {
    id: app.id,
    number: applicationNumber(app),
    status: app.status,
    assignedReviewerUserId: app.assignedReviewerUserId,
    interviewAt: app.interviewAt,
    decidedAt: app.decidedAt,
  };
}

/** Re-read under lock and fail if anything the pre-checks relied on moved. */
async function lockUnchanged(
  ctx: ServiceContext,
  snapshot: ApplicationRecord,
): Promise<ApplicationRecord> {
  const current = await loadSubmittedApplication(ctx, snapshot.id, { forUpdate: true });
  if (
    current.status !== snapshot.status ||
    current.assignedReviewerUserId !== snapshot.assignedReviewerUserId
  ) {
    throw new ConflictError('This application changed while you were working on it. Reload.');
  }
  return current;
}

/**
 * Claim an application for review (SUBMITTED → REVIEW), or reassign one
 * already in review. Claiming for yourself needs canReviewApplications;
 * assigning someone else, or taking over another reviewer's application,
 * needs canDecideApplications.
 */
export async function startReview(
  ctx: ServiceContext,
  input: z.input<typeof startReviewSchema>,
): Promise<ApplicationStaffSummary> {
  const data = parseInput(startReviewSchema, input);
  const target = { type: 'application', id: data.applicationId };
  await authorize(ctx, 'canReviewApplications', target);
  const me = actorUserId(ctx.actor);
  const reviewerUserId = data.reviewerUserId ?? me;
  if (!reviewerUserId) {
    throw new ValidationError('Choose a reviewer.', [
      { path: 'reviewerUserId', message: 'required' },
    ]);
  }
  const app = await loadSubmittedApplication(ctx, data.applicationId);
  await assertNotOwnApplication(ctx, app, 'start_review');
  if (!IN_FLIGHT_STATUSES.includes(app.status)) {
    throw new InvalidStateError(
      `This application is ${app.status.toUpperCase()}. Review is closed.`,
    );
  }
  if (app.assignedReviewerUserId === reviewerUserId) return toStaffSummary(app);
  if (reviewerUserId === app.userId) {
    throw new ValidationError('An applicant cannot review their own application.', [
      { path: 'reviewerUserId', message: 'applicant' },
    ]);
  }
  const assigningOther = reviewerUserId !== me;
  const takingOver = app.assignedReviewerUserId !== null;
  if (assigningOther || takingOver) await authorize(ctx, 'canDecideApplications', target);
  if (assigningOther) await assertEligibleReviewer(ctx, reviewerUserId);

  return withTransaction(ctx, async (tx) => {
    const current = await lockUnchanged(tx, app);
    const memberId = await applicantMemberId(tx, current.userId);
    const number = applicationNumber(current);
    let updated: ApplicationRecord;
    if (current.status === 'submitted') {
      updated = await transitionApplication(tx, current, 'review', {
        set: { assignedReviewerUserId: reviewerUserId },
        note: 'review started',
        subjectMemberId: memberId,
      });
      await notify(tx, {
        recipientUserId: current.userId,
        type: 'application.updated',
        ...applicantCopy.inReview(number),
        data: { applicationId: current.id, number },
        dedupeKey: `application:${current.id}:in-review`,
      });
    } else {
      updated = await updateApplication(tx, current.id, {
        assignedReviewerUserId: reviewerUserId,
      });
      await refreshReviewCard(tx, current.id);
    }
    await recordAudit(tx, {
      action: 'application.review_assigned',
      targetType: 'application',
      targetId: current.id,
      context: { number, reviewerUserId, previousReviewerUserId: current.assignedReviewerUserId },
    });
    if (assigningOther) {
      await notify(tx, {
        recipientUserId: reviewerUserId,
        type: 'application.received',
        ...reviewerCopy.assigned(number),
        data: { applicationId: current.id, number },
        dedupeKey: `application:${current.id}:assigned:${reviewerUserId}:${tx.clock.now().getTime()}`,
      });
    }
    return toStaffSummary(updated);
  });
}

export interface ReviewResult {
  applicationId: string;
  recommendation: ApplicationRecommendation;
  score: number | null;
  note: string | null;
  /** False on first review, true when the reviewer replaced their earlier one. */
  updated: boolean;
  status: ApplicationStatus;
}

/**
 * Record the caller's review (one per reviewer; a second call replaces it).
 * A first review on a SUBMITTED application moves it to REVIEW.
 */
export async function reviewApplication(
  ctx: ServiceContext,
  input: z.input<typeof reviewSchema>,
): Promise<ReviewResult> {
  const data = parseInput(reviewSchema, input);
  await authorize(ctx, 'canReviewApplications', { type: 'application', id: data.applicationId });
  const reviewer = requireUser(ctx);
  const app = await loadSubmittedApplication(ctx, data.applicationId);
  await assertNotOwnApplication(ctx, app, 'review');
  if (!IN_FLIGHT_STATUSES.includes(app.status)) {
    throw new InvalidStateError(
      `This application is ${app.status.toUpperCase()}. Reviews are closed.`,
    );
  }

  return withTransaction(ctx, async (tx) => {
    let current = await loadSubmittedApplication(tx, app.id, { forUpdate: true });
    if (!IN_FLIGHT_STATUSES.includes(current.status)) {
      throw new ConflictError('This application changed while you were working on it. Reload.');
    }
    const memberId = await applicantMemberId(tx, current.userId);
    const number = applicationNumber(current);
    if (current.status === 'submitted') {
      current = await transitionApplication(tx, current, 'review', {
        set: { assignedReviewerUserId: current.assignedReviewerUserId ?? reviewer.userId },
        note: 'review started by first review',
        subjectMemberId: memberId,
      });
      await notify(tx, {
        recipientUserId: current.userId,
        type: 'application.updated',
        ...applicantCopy.inReview(number),
        data: { applicationId: current.id, number },
        dedupeKey: `application:${current.id}:in-review`,
      });
    }
    const now = tx.clock.now();
    const [previous] = await tx.db
      .select({ id: applicationReviews.id })
      .from(applicationReviews)
      .where(
        and(
          eq(applicationReviews.applicationId, current.id),
          eq(applicationReviews.reviewerUserId, reviewer.userId),
        ),
      );
    const values = {
      recommendation: data.recommendation,
      score: data.score ?? null,
      note: data.note ?? null,
      updatedAt: now,
    };
    await tx.db
      .insert(applicationReviews)
      .values({
        applicationId: current.id,
        reviewerUserId: reviewer.userId,
        ...values,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [applicationReviews.applicationId, applicationReviews.reviewerUserId],
        set: values,
      });
    await recordAudit(tx, {
      action: 'application.reviewed',
      targetType: 'application',
      targetId: current.id,
      context: {
        number,
        recommendation: data.recommendation,
        score: data.score ?? null,
        replaced: Boolean(previous),
      },
    });
    await publishEvent(tx, {
      type: 'application.reviewed',
      aggregateType: 'application',
      aggregateId: current.id,
      subjectMemberId: memberId,
      payload: {
        applicationId: current.id,
        number,
        recommendation: data.recommendation,
        replaced: Boolean(previous),
      },
    });
    await refreshReviewCard(tx, current.id);
    return {
      applicationId: current.id,
      recommendation: data.recommendation,
      score: data.score ?? null,
      note: data.note ?? null,
      updated: Boolean(previous),
      status: current.status,
    };
  });
}

/**
 * Invite the applicant to an interview (REVIEW → INTERVIEW) or move an
 * existing one. The time must fall inside the interview scheduling window.
 */
export async function scheduleInterview(
  ctx: ServiceContext,
  input: z.input<typeof scheduleInterviewSchema>,
): Promise<ApplicationStaffSummary> {
  const data = parseInput(scheduleInterviewSchema, input);
  await authorize(ctx, 'canDecideApplications', { type: 'application', id: data.applicationId });
  const now = ctx.clock.now();
  const lead = data.interviewAt.getTime() - now.getTime();
  if (lead < MIN_INTERVIEW_LEAD_MS) {
    throw new ValidationError(
      `Pick a time at least ${MIN_INTERVIEW_LEAD_MS / MINUTE} minutes ahead.`,
      [{ path: 'interviewAt', message: 'must be in the future' }],
    );
  }
  if (lead > MAX_INTERVIEW_HORIZON_MS) {
    throw new ValidationError(
      `Pick a time within the next ${MAX_INTERVIEW_HORIZON_MS / DAY} days.`,
      [{ path: 'interviewAt', message: 'too far ahead' }],
    );
  }
  const app = await loadSubmittedApplication(ctx, data.applicationId);
  await assertNotOwnApplication(ctx, app, 'schedule_interview');
  if (app.status !== 'review' && app.status !== 'interview') {
    throw new InvalidStateError(
      `This application is ${app.status.toUpperCase()}. Interviews follow review.`,
    );
  }

  return withTransaction(ctx, async (tx) => {
    const current = await lockUnchanged(tx, app);
    const memberId = await applicantMemberId(tx, current.userId);
    const number = applicationNumber(current);
    const rescheduled = current.status === 'interview';
    let updated: ApplicationRecord;
    if (rescheduled) {
      updated = await updateApplication(tx, current.id, { interviewAt: data.interviewAt });
      await refreshReviewCard(tx, current.id);
    } else {
      updated = await transitionApplication(tx, current, 'interview', {
        set: { interviewAt: data.interviewAt },
        note: 'interview scheduled',
        subjectMemberId: memberId,
      });
    }
    const previousReminder = currentInterviewReminderKey(current);
    if (previousReminder) await cancelJob(tx, previousReminder);
    const remindAt = new Date(data.interviewAt.getTime() - INTERVIEW_REMINDER_LEAD_MS);
    if (remindAt.getTime() > now.getTime()) {
      await enqueueJob(
        tx,
        APPLICATION_INTERVIEW_REMINDER_JOB,
        { applicationId: current.id, interviewAt: data.interviewAt.toISOString() },
        { runAt: remindAt, dedupeKey: interviewReminderKey(current.id, data.interviewAt) },
      );
    }
    await recordAudit(tx, {
      action: 'application.interview_scheduled',
      targetType: 'application',
      targetId: current.id,
      context: {
        number,
        interviewAt: data.interviewAt.toISOString(),
        previous: current.interviewAt?.toISOString() ?? null,
      },
    });
    await publishEvent(tx, {
      type: 'application.interview_scheduled',
      aggregateType: 'application',
      aggregateId: current.id,
      subjectMemberId: memberId,
      payload: {
        applicationId: current.id,
        number,
        interviewAt: data.interviewAt.toISOString(),
        rescheduled,
      },
    });
    await notify(tx, {
      recipientUserId: current.userId,
      type: 'application.updated',
      ...applicantCopy.interviewScheduled(
        number,
        data.interviewAt,
        rescheduled,
        data.applicantMessage ?? null,
      ),
      data: { applicationId: current.id, number, interviewAt: data.interviewAt.toISOString() },
      dedupeKey: `application:${current.id}:interview:${data.interviewAt.toISOString()}`,
    });
    return toStaffSummary(updated);
  });
}
