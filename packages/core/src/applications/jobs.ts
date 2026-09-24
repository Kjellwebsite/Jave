import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { applications } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type JobHandler, PermanentJobError, type RecurringJob } from '../jobs/worker';
import { DAY, HOUR } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import { getSettings } from '../settings/settings.service';
import { applicantCopy, reviewerCopy } from './copy';
import {
  applicantMemberId,
  applicationNumber,
  findApplication,
  KEEP_UPDATED_AT,
  transitionApplication,
} from './repository';
import {
  APPLICATION_DRAFT_EXPIRY_JOB,
  APPLICATION_INTERVIEW_REMINDER_JOB,
  APPLICATION_REVIEW_REMINDER_JOB,
} from './keys';
import { reviewReminderCutoff } from './rules';

/** Background work. Handlers run with a system actor and are idempotent. */

/** How often the sweeps run. */
export const APPLICATION_SWEEP_INTERVAL_MS = HOUR;
/** Rows handled per sweep run; the next run picks up the rest. */
export const APPLICATION_SWEEP_BATCH_SIZE = 100;

/**
 * Withdraw drafts with no edits for settings.applications.draftExpiryDays.
 * Each draft closes in its own transaction; a draft edited after the scan
 * is left alone (re-checked under lock).
 */
export const expireStaleDrafts: JobHandler = async (ctx) => {
  const settings = await getSettings(ctx, 'applications');
  const cutoff = new Date(ctx.clock.now().getTime() - settings.draftExpiryDays * DAY);
  const stale = await ctx.db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.status, 'draft'), lt(applications.updatedAt, cutoff)))
    .orderBy(asc(applications.updatedAt))
    .limit(APPLICATION_SWEEP_BATCH_SIZE);
  let expired = 0;
  for (const { id } of stale) {
    if (await expireDraft(ctx, id, cutoff, settings.draftExpiryDays)) expired++;
  }
  return { expired, more: stale.length === APPLICATION_SWEEP_BATCH_SIZE };
};

async function expireDraft(
  ctx: ServiceContext,
  applicationId: string,
  cutoff: Date,
  expiryDays: number,
): Promise<boolean> {
  return withTransaction(ctx, async (tx) => {
    const app = await findApplication(tx, applicationId, { forUpdate: true });
    if (!app || app.status !== 'draft' || app.updatedAt.getTime() >= cutoff.getTime()) {
      return false;
    }
    const memberId = await applicantMemberId(tx, app.userId);
    const number = applicationNumber(app);
    await transitionApplication(tx, app, 'withdrawn', {
      note: `expired: no edits for ${expiryDays} days`,
      subjectMemberId: memberId,
    });
    await recordAudit(tx, {
      action: 'application.expired',
      targetType: 'application',
      targetId: app.id,
      context: { number, expiryDays },
    });
    await publishEvent(tx, {
      type: 'application.withdrawn',
      aggregateType: 'application',
      aggregateId: app.id,
      subjectMemberId: memberId,
      payload: { applicationId: app.id, number, from: 'draft', by: 'expiry' },
    });
    await notify(tx, {
      recipientUserId: app.userId,
      type: 'application.updated',
      ...applicantCopy.draftExpired(number, expiryDays),
      data: { applicationId: app.id, number },
      dedupeKey: `application:${app.id}:expired`,
    });
    return true;
  });
}

/**
 * Remind reviewers, once per application, about submissions nobody has
 * picked up within settings.applications.reviewReminderHours.
 */
export const remindWaitingReviews: JobHandler = async (ctx) => {
  const settings = await getSettings(ctx, 'applications');
  const now = ctx.clock.now();
  const cutoff = reviewReminderCutoff(now, settings.reviewReminderHours);
  const waiting = await ctx.db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.status, 'submitted'),
        lt(applications.submittedAt, cutoff),
        isNull(applications.reviewReminderSentAt),
      ),
    )
    .orderBy(asc(applications.submittedAt))
    .limit(APPLICATION_SWEEP_BATCH_SIZE);
  let reminded = 0;
  for (const { id } of waiting) {
    const sent = await withTransaction(ctx, async (tx) => {
      // Claim the reminder atomically so overlapping sweeps send it once.
      const [claimed] = await tx.db
        .update(applications)
        .set({ reviewReminderSentAt: now, updatedAt: KEEP_UPDATED_AT })
        .where(
          and(
            eq(applications.id, id),
            eq(applications.status, 'submitted'),
            isNull(applications.reviewReminderSentAt),
          ),
        )
        .returning();
      if (!claimed) return false;
      const number = applicationNumber(claimed);
      await notifyCapabilityHolders(
        tx,
        'canReviewApplications',
        {
          type: 'application.received',
          ...reviewerCopy.waiting(number, settings.reviewReminderHours),
          data: { applicationId: claimed.id, number },
          dedupeKey: `application:${claimed.id}:review-reminder`,
        },
        { excludeUserIds: [claimed.userId] },
      );
      return true;
    });
    if (sent) reminded++;
  }
  return { reminded, more: waiting.length === APPLICATION_SWEEP_BATCH_SIZE };
};

const interviewReminderPayloadSchema = z.object({
  applicationId: z.uuid(),
  interviewAt: z.iso.datetime(),
});

/** Remind the applicant shortly before their interview, if it still stands. */
export const remindInterview: JobHandler = async (ctx, payload) => {
  const parsed = interviewReminderPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError('invalid interview reminder payload');
  const app = await findApplication(ctx, parsed.data.applicationId);
  if (!app) return { skipped: 'application missing' };
  if (app.status !== 'interview' || app.interviewAt?.toISOString() !== parsed.data.interviewAt) {
    return { skipped: 'interview moved or closed' };
  }
  const number = applicationNumber(app);
  await notify(ctx, {
    recipientUserId: app.userId,
    type: 'application.updated',
    ...applicantCopy.interviewReminder(number, app.interviewAt),
    data: { applicationId: app.id, number, interviewAt: parsed.data.interviewAt },
    dedupeKey: `application:${app.id}:interview-reminder:${parsed.data.interviewAt}`,
  });
  return { reminded: true };
};

export const applicationJobHandlers = {
  [APPLICATION_DRAFT_EXPIRY_JOB]: expireStaleDrafts,
  [APPLICATION_REVIEW_REMINDER_JOB]: remindWaitingReviews,
  [APPLICATION_INTERVIEW_REMINDER_JOB]: remindInterview,
} as const;

export const applicationRecurringJobs: readonly RecurringJob[] = [
  { type: APPLICATION_DRAFT_EXPIRY_JOB, everyMs: APPLICATION_SWEEP_INTERVAL_MS },
  { type: APPLICATION_REVIEW_REMINDER_JOB, everyMs: APPLICATION_SWEEP_INTERVAL_MS },
];
