import { and, asc, eq, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { applicationReviews, applications } from '@jave/database';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import { getSettings } from '../settings/settings.service';
import { applicantCopy, reviewerCopy } from './copy';
import { isEligibleReviewer } from './guards';
import { applicationNumber, findApplication, KEEP_UPDATED_AT } from './repository';
import { reviewReminderCutoff } from './rules';

/** Reminder jobs. Handlers run with a system actor and are idempotent. */

/** Rows handled per sweep run; the next run picks up the rest. */
export const APPLICATION_SWEEP_BATCH_SIZE = 100;

interface SweepResult {
  reminded: number;
  more: boolean;
}

/** No non-abstaining review exists yet. */
const NO_COUNTED_REVIEW: SQL = sql`not exists (
  select 1 from ${applicationReviews}
  where ${applicationReviews.applicationId} = ${applications.id}
    and ${applicationReviews.recommendation} <> 'abstain'
)`;

/**
 * Remind, once per wait, about applications nobody is moving:
 * - SUBMITTED and unclaimed for reviewReminderHours → every reviewer;
 * - in REVIEW with no counted review for reviewReminderHours since the
 *   current assignment → the assigned reviewer, or the deciders when that
 *   reviewer can no longer review (so someone reassigns it).
 */
export const remindWaitingReviews: JobHandler = async (ctx) => {
  const settings = await getSettings(ctx, 'applications');
  const now = ctx.clock.now();
  const cutoff = reviewReminderCutoff(now, settings.reviewReminderHours);
  const unclaimed = await remindUnclaimed(ctx, cutoff, settings.reviewReminderHours);
  const assigned = await remindStalledAssignments(ctx, cutoff, settings.reviewReminderHours);
  return {
    reminded: unclaimed.reminded,
    assignmentsReminded: assigned.reminded,
    more: unclaimed.more || assigned.more,
  };
};

async function remindUnclaimed(ctx: ServiceContext, cutoff: Date, hours: number) {
  const waitingFilter = and(
    eq(applications.status, 'submitted'),
    lt(applications.submittedAt, cutoff),
    isNull(applications.reviewReminderSentAt),
  );
  return sweep(ctx, waitingFilter, asc(applications.submittedAt), async (tx, id) => {
    // Claim the reminder atomically so overlapping sweeps send it once.
    const claimed = await claimReminder(tx, id, waitingFilter);
    if (!claimed) return false;
    const number = applicationNumber(claimed);
    await notifyCapabilityHolders(
      tx,
      'canReviewApplications',
      {
        type: 'application.received',
        ...reviewerCopy.waiting(number, hours),
        data: { applicationId: claimed.id, number },
        dedupeKey: `application:${claimed.id}:review-reminder`,
      },
      { excludeUserIds: [claimed.userId] },
    );
    return true;
  });
}

async function remindStalledAssignments(ctx: ServiceContext, cutoff: Date, hours: number) {
  const stalledFilter = and(
    eq(applications.status, 'review'),
    isNotNull(applications.assignedReviewerUserId),
    lt(applications.reviewAssignedAt, cutoff),
    isNull(applications.reviewReminderSentAt),
    NO_COUNTED_REVIEW,
  );
  return sweep(ctx, stalledFilter, asc(applications.reviewAssignedAt), async (tx, id) => {
    const claimed = await claimReminder(tx, id, stalledFilter);
    if (!claimed?.assignedReviewerUserId || !claimed.reviewAssignedAt) return false;
    const number = applicationNumber(claimed);
    const base = {
      type: 'application.received' as const,
      data: { applicationId: claimed.id, number },
      // One reminder per assignment.
      dedupeKey: `application:${claimed.id}:assignment-reminder:${claimed.reviewAssignedAt.getTime()}`,
    };
    if (await isEligibleReviewer(tx, claimed.assignedReviewerUserId)) {
      await notify(tx, {
        ...base,
        ...reviewerCopy.assignmentWaiting(number, hours),
        recipientUserId: claimed.assignedReviewerUserId,
      });
    } else {
      await notifyCapabilityHolders(
        tx,
        'canDecideApplications',
        { ...base, ...reviewerCopy.reviewerUnavailable(number, hours) },
        { excludeUserIds: [claimed.userId] },
      );
    }
    return true;
  });
}

/** Stamp the reminder flag if the row still matches `filter`; null when another sweep won. */
async function claimReminder(tx: ServiceContext, id: string, filter: SQL | undefined) {
  const [claimed] = await tx.db
    .update(applications)
    .set({ reviewReminderSentAt: tx.clock.now(), updatedAt: KEEP_UPDATED_AT })
    .where(and(eq(applications.id, id), filter))
    .returning();
  return claimed ?? null;
}

/** Scan one batch matching `filter`; remind each row in its own transaction. */
async function sweep(
  ctx: ServiceContext,
  filter: SQL | undefined,
  order: SQL,
  remind: (tx: ServiceContext, id: string) => Promise<boolean>,
): Promise<SweepResult> {
  const rows = await ctx.db
    .select({ id: applications.id })
    .from(applications)
    .where(filter)
    .orderBy(order)
    .limit(APPLICATION_SWEEP_BATCH_SIZE);
  let reminded = 0;
  for (const { id } of rows) {
    if (await withTransaction(ctx, (tx) => remind(tx, id))) reminded++;
  }
  return { reminded, more: rows.length === APPLICATION_SWEEP_BATCH_SIZE };
}

const interviewReminderPayloadSchema = z.object({
  applicationId: z.uuid(),
  interviewAt: z.iso.datetime(),
});

/**
 * Remind the applicant shortly before their interview, if it still stands.
 * The check and the notification share one transaction, so a failure part
 * way leaves nothing behind and the retry sends the reminder in full.
 */
export const remindInterview: JobHandler = async (ctx, payload) => {
  const parsed = interviewReminderPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError('invalid interview reminder payload');
  const { applicationId, interviewAt } = parsed.data;
  return withTransaction(ctx, async (tx) => {
    const app = await findApplication(tx, applicationId, { forUpdate: true });
    if (!app) return { skipped: 'application missing' };
    if (app.status !== 'interview' || app.interviewAt?.toISOString() !== interviewAt) {
      return { skipped: 'interview moved or closed' };
    }
    const number = applicationNumber(app);
    const notificationId = await notify(tx, {
      recipientUserId: app.userId,
      type: 'application.updated',
      ...applicantCopy.interviewReminder(number, app.interviewAt),
      data: { applicationId: app.id, number, interviewAt },
      dedupeKey: `application:${app.id}:interview-reminder:${interviewAt}`,
    });
    return { reminded: notificationId !== null };
  });
};
