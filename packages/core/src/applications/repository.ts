import { and, asc, desc, eq, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import {
  applicationReviews,
  applications,
  applicationStatusChanges,
  members,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, NotFoundError } from '../kernel/errors';
import { formatNumber } from '../kernel/ids';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { actorUserId } from '../permissions/actor';
import { APPLICATION_REVIEW_CARD_JOB } from './discord-jobs';
import { reviewCardKey } from './keys';
import type { ApplicationClosure } from './rules';
import {
  type ApplicationStatus,
  assertTransition,
  IN_FLIGHT_STATUSES,
  OPEN_STATUSES,
} from './state-machine';

/** Data access shared by the application services. Callers authorize first. */

export type ApplicationRecord = typeof applications.$inferSelect;
export type ApplicationReviewRecord = typeof applicationReviews.$inferSelect;
export type ApplicationStatusChangeRecord = typeof applicationStatusChanges.$inferSelect;

export const APPLICATION_NUMBER_PREFIX = 'APP';

/**
 * Bookkeeping writes (card revisions, reminder flags) must not count as an
 * edit: `updated_at` drives draft expiry. Assigning the column to itself
 * also stops the schema's `$onUpdate` default from stamping wall-clock time.
 */
export const KEEP_UPDATED_AT = sql`${applications.updatedAt}`;

export function applicationNumber(app: Pick<ApplicationRecord, 'number'>): string {
  return formatNumber(APPLICATION_NUMBER_PREFIX, app.number);
}

export async function findApplication(
  ctx: ServiceContext,
  applicationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicationRecord | null> {
  const query = ctx.db.select().from(applications).where(eq(applications.id, applicationId));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function loadApplication(
  ctx: ServiceContext,
  applicationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicationRecord> {
  const row = await findApplication(ctx, applicationId, options);
  if (!row) throw new NotFoundError('Application');
  return row;
}

/** Staff never see drafts: an application that was never submitted does not exist to them. */
export async function loadSubmittedApplication(
  ctx: ServiceContext,
  applicationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicationRecord> {
  const row = await findApplication(ctx, applicationId, options);
  if (!row || row.submittedAt === null) throw new NotFoundError('Application');
  return row;
}

export async function findOpenApplication(
  ctx: ServiceContext,
  userId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ApplicationRecord | null> {
  const query = ctx.db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.status, [...OPEN_STATUSES])));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** The open application, or else the most recent closed one. */
export async function findLatestApplication(
  ctx: ServiceContext,
  userId: string,
): Promise<ApplicationRecord | null> {
  const open = await findOpenApplication(ctx, userId);
  if (open) return open;
  const [row] = await ctx.db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.createdAt), desc(applications.number))
    .limit(1);
  return row ?? null;
}

/**
 * The latest rejection and the latest withdrawal from each post-submission
 * state for this person, read from the status change log. Discarded drafts
 * are not closures: they never reached staff.
 */
export async function loadClosures(
  ctx: ServiceContext,
  userId: string,
): Promise<ApplicationClosure[]> {
  const rows = await ctx.db
    .select({
      to: applicationStatusChanges.toStatus,
      from: applicationStatusChanges.fromStatus,
      at: max(applicationStatusChanges.createdAt),
    })
    .from(applicationStatusChanges)
    .innerJoin(applications, eq(applications.id, applicationStatusChanges.applicationId))
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applicationStatusChanges.toStatus, ['rejected', 'withdrawn']),
        inArray(applicationStatusChanges.fromStatus, [...IN_FLIGHT_STATUSES]),
      ),
    )
    .groupBy(applicationStatusChanges.toStatus, applicationStatusChanges.fromStatus);
  const closures: ApplicationClosure[] = [];
  for (const row of rows) {
    if (!row.at || !row.from) continue;
    closures.push(
      row.to === 'rejected'
        ? { outcome: 'rejected', at: row.at }
        : { outcome: 'withdrawn', from: row.from, at: row.at },
    );
  }
  return closures;
}

/** The applicant's (non-deleted) member id, if they still have a profile. */
export async function applicantMemberId(
  ctx: ServiceContext,
  userId: string,
): Promise<string | null> {
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), isNull(members.deletedAt)));
  return row?.id ?? null;
}

export interface PersonRef {
  userId: string;
  memberId: string | null;
  discordId: string;
  displayName: string;
  handle: string | null;
}

/** Display identities for a set of users, in one query. */
export async function loadPeople(
  ctx: ServiceContext,
  userIds: readonly (string | null | undefined)[],
): Promise<Map<string, PersonRef>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      userId: users.id,
      discordId: users.discordId,
      memberId: members.id,
      handle: members.handle,
      displayName: sql<string>`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`,
    })
    .from(users)
    .leftJoin(members, and(eq(members.userId, users.id), isNull(members.deletedAt)))
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.userId, row]));
}

export async function loadReviews(
  ctx: ServiceContext,
  applicationId: string,
): Promise<ApplicationReviewRecord[]> {
  return ctx.db
    .select()
    .from(applicationReviews)
    .where(eq(applicationReviews.applicationId, applicationId))
    .orderBy(asc(applicationReviews.createdAt), asc(applicationReviews.reviewerUserId));
}

export async function loadStatusHistory(
  ctx: ServiceContext,
  applicationId: string,
): Promise<ApplicationStatusChangeRecord[]> {
  return ctx.db
    .select()
    .from(applicationStatusChanges)
    .where(eq(applicationStatusChanges.applicationId, applicationId))
    .orderBy(asc(applicationStatusChanges.createdAt), asc(applicationStatusChanges.sequence));
}

/** Update a row the caller already holds locked. */
export async function updateApplication(
  ctx: ServiceContext,
  applicationId: string,
  set: ApplicationPatch,
): Promise<ApplicationRecord> {
  const [row] = await ctx.db
    .update(applications)
    .set({ ...set, updatedAt: set.updatedAt ?? ctx.clock.now() })
    .where(eq(applications.id, applicationId))
    .returning();
  if (!row) throw new NotFoundError('Application');
  return row;
}

/**
 * Bump the review card revision and enqueue the Discord render. Call inside
 * the transaction that made the change. Returns the new revision, which also
 * numbers the change itself; null (no-op) for never-submitted drafts.
 */
export async function refreshReviewCard(
  ctx: ServiceContext,
  applicationId: string,
): Promise<number | null> {
  const [row] = await ctx.db
    .update(applications)
    .set({
      reviewCardRevision: sql`${applications.reviewCardRevision} + 1`,
      updatedAt: KEEP_UPDATED_AT,
    })
    .where(and(eq(applications.id, applicationId), isNotNull(applications.submittedAt)))
    .returning({ revision: applications.reviewCardRevision });
  if (!row) return null;
  await enqueueJob(
    ctx,
    APPLICATION_REVIEW_CARD_JOB,
    { applicationId, revision: row.revision },
    { dedupeKey: reviewCardKey(applicationId, row.revision) },
  );
  return row.revision;
}

export type ApplicationPatch = Partial<
  Omit<ApplicationRecord, 'id' | 'number' | 'userId' | 'status' | 'createdAt'>
>;

export interface TransitionOptions {
  /** Extra columns written with the status change. */
  set?: ApplicationPatch;
  /** Staff-visible note on the status change row. */
  note?: string | null;
  subjectMemberId: string | null;
}

/**
 * Move an application to `to`. Compare-and-set on the current status, so a
 * concurrent transition loses with ConflictError instead of overwriting.
 * Writes the status change row, the status_changed event and the review card
 * refresh. Returns the row as it stands after all of that (including the new
 * card revision). Must run inside a transaction.
 */
export async function transitionApplication(
  ctx: ServiceContext,
  app: ApplicationRecord,
  to: ApplicationStatus,
  options: TransitionOptions,
): Promise<ApplicationRecord> {
  assertTransition(app.status, to);
  const now = ctx.clock.now();
  const [updated] = await ctx.db
    .update(applications)
    .set({ ...options.set, status: to, updatedAt: now })
    .where(and(eq(applications.id, app.id), eq(applications.status, app.status)))
    .returning();
  if (!updated) {
    throw new ConflictError('This application changed while you were working on it. Reload.');
  }
  await ctx.db.insert(applicationStatusChanges).values({
    applicationId: app.id,
    fromStatus: app.status,
    toStatus: to,
    actorUserId: actorUserId(ctx.actor),
    note: options.note ?? null,
    createdAt: now,
  });
  await publishEvent(ctx, {
    type: 'application.status_changed',
    aggregateType: 'application',
    aggregateId: app.id,
    subjectMemberId: options.subjectMemberId,
    payload: {
      applicationId: app.id,
      number: applicationNumber(app),
      from: app.status,
      to,
    },
  });
  const revision = await refreshReviewCard(ctx, app.id);
  return revision === null ? updated : { ...updated, reviewCardRevision: revision };
}
