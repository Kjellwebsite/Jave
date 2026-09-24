import { and, asc, eq, lt } from 'drizzle-orm';
import { applications } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import type { JobHandler, RecurringJob } from '../jobs/worker';
import { DAY, HOUR } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { notify } from '../notifications/notifications.service';
import { getSettings } from '../settings/settings.service';
import { applicantCopy } from './copy';
import {
  APPLICATION_DRAFT_EXPIRY_JOB,
  APPLICATION_INTERVIEW_REMINDER_JOB,
  APPLICATION_REVIEW_REMINDER_JOB,
} from './keys';
import { APPLICATION_SWEEP_BATCH_SIZE, remindInterview, remindWaitingReviews } from './reminders';
import {
  applicantMemberId,
  applicationNumber,
  findApplication,
  transitionApplication,
} from './repository';

/** Draft expiry and the module's job registry. Handlers run with a system actor and are idempotent. */

/** How often the sweeps run. */
export const APPLICATION_SWEEP_INTERVAL_MS = HOUR;

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

export const applicationJobHandlers = {
  [APPLICATION_DRAFT_EXPIRY_JOB]: expireStaleDrafts,
  [APPLICATION_REVIEW_REMINDER_JOB]: remindWaitingReviews,
  [APPLICATION_INTERVIEW_REMINDER_JOB]: remindInterview,
} as const;

export const applicationRecurringJobs: readonly RecurringJob[] = [
  { type: APPLICATION_DRAFT_EXPIRY_JOB, everyMs: APPLICATION_SWEEP_INTERVAL_MS },
  { type: APPLICATION_REVIEW_REMINDER_JOB, everyMs: APPLICATION_SWEEP_INTERVAL_MS },
];
