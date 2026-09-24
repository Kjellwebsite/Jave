import { and, asc, count, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { applicationReviews, applications, referralCodes } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { assertNotOwnApplication } from './guards';
import {
  applicationNumber,
  loadPeople,
  loadReviews,
  loadStatusHistory,
  loadSubmittedApplication,
} from './repository';
import { applicationRefSchema, listApplicationsSchema } from './schemas';
import { type ApplicationListItem, type StaffApplicationView, toStaffView } from './views';

/** Staff read paths. Drafts are never visible here: only submitted applications exist to staff. */

export async function listApplications(
  ctx: ServiceContext,
  input: z.input<typeof listApplicationsSchema> = {},
): Promise<Page<ApplicationListItem>> {
  await authorize(ctx, 'canViewApplications', { type: 'application' });
  const q = parseInput(listApplicationsSchema, input);
  const filters: SQL[] = [isNotNull(applications.submittedAt)];
  if (q.status !== undefined) {
    const statuses = Array.isArray(q.status) ? q.status : [q.status];
    filters.push(inArray(applications.status, statuses));
  }
  if (q.domainKey) filters.push(eq(applications.domainKey, q.domainKey));
  if (q.number !== undefined) filters.push(eq(applications.number, q.number));
  if (q.assignedToMe) {
    const me = actorUserId(ctx.actor);
    // Non-user actors have no assignments.
    filters.push(me ? eq(applications.assignedReviewerUserId, me) : sql`false`);
  }
  const where = and(...filters);
  const order =
    q.sort === 'newest'
      ? [desc(applications.submittedAt), desc(applications.number)]
      : [asc(applications.submittedAt), asc(applications.number)];

  const rows = await ctx.db
    .select({
      id: applications.id,
      number: applications.number,
      status: applications.status,
      domainKey: applications.domainKey,
      userId: applications.userId,
      assignedReviewerUserId: applications.assignedReviewerUserId,
      submittedAt: applications.submittedAt,
      interviewAt: applications.interviewAt,
      decidedAt: applications.decidedAt,
      updatedAt: applications.updatedAt,
      reviewCount: sql<number>`(select count(*)::int from ${applicationReviews} where ${applicationReviews.applicationId} = ${applications.id})`,
    })
    .from(applications)
    .where(where)
    .orderBy(...order)
    .limit(q.limit)
    .offset(q.offset);
  const [total] = await ctx.db.select({ value: count() }).from(applications).where(where);
  const people = await loadPeople(
    ctx,
    rows.flatMap((row) => [row.userId, row.assignedReviewerUserId]),
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      number: applicationNumber(row),
      status: row.status,
      domainKey: row.domainKey,
      applicant: people.get(row.userId) ?? null,
      assignedReviewer: row.assignedReviewerUserId
        ? (people.get(row.assignedReviewerUserId) ?? null)
        : null,
      reviewCount: row.reviewCount,
      submittedAt: row.submittedAt,
      interviewAt: row.interviewAt,
      decidedAt: row.decidedAt,
      updatedAt: row.updatedAt,
    })),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

/**
 * Full staff view: answers, private references, reviews with reviewer
 * identities, status history and the internal decision reason. Every read is
 * audited because it exposes private applicant data.
 */
export async function getApplication(
  ctx: ServiceContext,
  input: z.input<typeof applicationRefSchema>,
): Promise<StaffApplicationView> {
  const { applicationId } = parseInput(applicationRefSchema, input);
  await authorize(ctx, 'canViewApplications', { type: 'application', id: applicationId });
  const app = await loadSubmittedApplication(ctx, applicationId);
  await assertNotOwnApplication(ctx, app, 'view');

  const reviews = await loadReviews(ctx, app.id);
  const history = await loadStatusHistory(ctx, app.id);
  let referralOwnerUserId: string | null = null;
  if (app.referralCode) {
    const [referral] = await ctx.db
      .select({ ownerUserId: referralCodes.ownerUserId })
      .from(referralCodes)
      .where(eq(referralCodes.code, app.referralCode));
    referralOwnerUserId = referral?.ownerUserId ?? null;
  }
  const people = await loadPeople(ctx, [
    app.userId,
    app.assignedReviewerUserId,
    app.decidedByUserId,
    referralOwnerUserId,
    ...reviews.map((review) => review.reviewerUserId),
    ...history.map((change) => change.actorUserId),
  ]);
  await recordAudit(ctx, {
    action: 'application.viewed',
    targetType: 'application',
    targetId: app.id,
    context: { number: applicationNumber(app) },
  });
  return toStaffView(app, reviews, history, people, referralOwnerUserId);
}
