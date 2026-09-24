import { and, count, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contributionKind, contributions, evidence, members, projects } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { authorize, can, isSelf } from '../permissions/authorize';
import {
  activeRole,
  findProject,
  managedProjectIds,
  MANAGER_ROLES,
  type ProjectRecord,
  requireActiveMember,
  visibleProjectsFilter,
} from './access';
import { userIdOfMember } from './recipients';
import { httpUrl, plainText, plausibleDate, singleLine } from './schemas';

export type ContributionRecord = typeof contributions.$inferSelect;
export type ContributionKind = (typeof contributionKind.enumValues)[number];

/** Anti-spam ceiling on a member's contributions awaiting review. */
export const MAX_PENDING_CONTRIBUTIONS = 25;

const kindSchema = z.enum(contributionKind.enumValues as [ContributionKind, ...ContributionKind[]]);

export const recordContributionSchema = z.object({
  projectId: z.uuid().optional(),
  kind: kindSchema,
  title: singleLine(200, 3),
  description: plainText(4000).optional(),
  url: httpUrl.optional(),
  occurredAt: plausibleDate.optional(),
});

export const reviewContributionSchema = z.object({
  contributionId: z.uuid(),
  note: plainText(1000).optional(),
});

export const rejectContributionSchema = z.object({
  contributionId: z.uuid(),
  reason: plainText(1000, 3),
});

export const listContributionsSchema = pageSchema.extend({
  memberId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  status: z.enum(['submitted', 'verified', 'rejected']).optional(),
  kind: kindSchema.optional(),
});

/** Events about a contribution leave JAVE only when its project is public (or it has none). */
function contributionEventBase(
  contribution: ContributionRecord,
  project: Pick<ProjectRecord, 'visibility'> | null,
) {
  return {
    contributionId: contribution.id,
    memberId: contribution.memberId,
    projectId: contribution.projectId,
    kind: contribution.kind,
    source: contribution.source,
    visibility: project?.visibility ?? 'public',
  };
}

async function notifyAuthor(
  ctx: ServiceContext,
  contribution: ContributionRecord,
  title: string,
  body: string,
  dedupeKey: string,
): Promise<void> {
  const userId = await userIdOfMember(ctx, contribution.memberId);
  if (!userId) return;
  await notify(ctx, {
    recipientUserId: userId,
    type: 'contribution.updated',
    title,
    body,
    data: { contributionId: contribution.id, status: contribution.status },
    dedupeKey,
  });
}

/** Accepted evidence backing a verified contribution (feeds capability verification). */
async function insertContributionEvidence(
  ctx: ServiceContext,
  contribution: ContributionRecord,
  now: Date,
): Promise<string> {
  const reviewerId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
  const [row] = await ctx.db
    .insert(evidence)
    .values({
      memberId: contribution.memberId,
      kind: 'contribution',
      title: contribution.title,
      url: contribution.url,
      description: contribution.description,
      sourceType: 'contribution',
      sourceId: contribution.id,
      status: 'accepted',
      reviewedByUserId: reviewerId,
      reviewedAt: now,
      createdByUserId: reviewerId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: evidence.id });
  return row!.id;
}

/** Record your own contribution, optionally on a project you actively belong to. */
export async function recordContribution(
  ctx: ServiceContext,
  input: z.input<typeof recordContributionSchema>,
): Promise<ContributionRecord> {
  const actor = requireActiveMember(ctx);
  const data = parseInput(recordContributionSchema, input);
  const now = ctx.clock.now();
  if (data.occurredAt && data.occurredAt.getTime() > now.getTime()) {
    throw new InvalidStateError('A contribution cannot be dated in the future.');
  }
  let project: ProjectRecord | null = null;
  if (data.projectId) {
    project = await findProject(ctx, data.projectId);
    const role = project ? await activeRole(ctx, project.id, actor.memberId) : null;
    // Same answer whether the project is missing, invisible, or you are not on it.
    if (!project || !role) throw new NotFoundError('Project');
    if (project.status === 'archived') {
      throw new InvalidStateError('Archived projects do not accept new contributions.');
    }
  }
  const [pending] = await ctx.db
    .select({ value: count() })
    .from(contributions)
    .where(and(eq(contributions.memberId, actor.memberId), eq(contributions.status, 'submitted')));
  if ((pending?.value ?? 0) >= MAX_PENDING_CONTRIBUTIONS) {
    throw new ConflictError(
      `You have ${MAX_PENDING_CONTRIBUTIONS} contributions awaiting review. Wait for reviews first.`,
    );
  }

  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .insert(contributions)
      .values({
        memberId: actor.memberId,
        projectId: project?.id ?? null,
        kind: data.kind,
        title: data.title,
        description: data.description || null,
        url: data.url ?? null,
        source: 'manual',
        occurredAt: data.occurredAt ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await publishEvent(t, {
      type: 'contribution.submitted',
      aggregateType: 'contribution',
      aggregateId: row!.id,
      subjectMemberId: actor.memberId,
      payload: contributionEventBase(row!, project),
    });
    return row!;
  });
}

async function loadContribution(
  ctx: ServiceContext,
  contributionId: string,
): Promise<{ contribution: ContributionRecord; project: ProjectRecord | null }> {
  const [contribution] = await ctx.db
    .select()
    .from(contributions)
    .where(eq(contributions.id, contributionId));
  if (!contribution) throw new NotFoundError('Contribution');
  const project = contribution.projectId ? await findProject(ctx, contribution.projectId) : null;
  return { contribution, project };
}

/**
 * Who vouched for a verified contribution. Consumers (achievements,
 * capability reviews) can weight staff review above peer review: project
 * managers verifying each other is the collusion-prone path.
 */
export type ContributionVerifier = 'staff' | 'project' | 'github' | 'system';

/**
 * Reviewers: canVerifyContributions, or an owner/maintainer (good standing)
 * of the contribution's project. Nobody reviews their own contribution —
 * that attempt is refused and audited durably.
 */
async function requireReviewer(
  ctx: ServiceContext,
  contribution: ContributionRecord,
  project: ProjectRecord | null,
): Promise<ContributionVerifier> {
  if (isSelf(ctx.actor, contribution.memberId)) {
    await recordAudit(
      ctx,
      {
        action: 'contribution.self_review_blocked',
        targetType: 'contribution',
        targetId: contribution.id,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot review your own contribution.');
  }
  if (can(ctx, 'canVerifyContributions')) return 'staff';
  if (project && ctx.actor.kind === 'user' && ctx.actor.memberId && ctx.actor.standing === 'good') {
    const role = await activeRole(ctx, project.id, ctx.actor.memberId);
    if (role && MANAGER_ROLES.includes(role)) return 'project';
  }
  await authorize(ctx, 'canVerifyContributions', {
    type: 'contribution',
    id: contribution.id,
  });
  return 'staff';
}

/** Verify a submitted contribution: accepted evidence + contribution.verified. */
export async function verifyContribution(
  ctx: ServiceContext,
  input: z.input<typeof reviewContributionSchema>,
): Promise<ContributionRecord> {
  const data = parseInput(reviewContributionSchema, input);
  const { contribution, project } = await loadContribution(ctx, data.contributionId);
  const verifiedBy = await requireReviewer(ctx, contribution, project);
  if (contribution.status !== 'submitted') {
    throw new InvalidStateError(`This contribution is already ${contribution.status}.`);
  }
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const reviewerId = t.actor.kind === 'user' ? t.actor.userId : null;
    const [updated] = await t.db
      .update(contributions)
      .set({
        status: 'verified',
        verifiedByUserId: reviewerId,
        verifiedAt: now,
        reviewedByUserId: reviewerId,
        reviewedAt: now,
        reviewNote: data.note || null,
        updatedAt: now,
      })
      .where(and(eq(contributions.id, contribution.id), eq(contributions.status, 'submitted')))
      .returning();
    if (!updated) throw new ConflictError('This contribution was reviewed in the meantime.');
    const evidenceId = await insertContributionEvidence(t, updated, now);
    await recordAudit(t, {
      action: 'contribution.verified',
      targetType: 'contribution',
      targetId: contribution.id,
      context: {
        memberId: contribution.memberId,
        projectId: contribution.projectId,
        evidenceId,
        verifiedBy,
      },
    });
    await publishEvent(t, {
      type: 'contribution.verified',
      aggregateType: 'contribution',
      aggregateId: contribution.id,
      subjectMemberId: contribution.memberId,
      payload: { ...contributionEventBase(updated, project), evidenceId, verifiedBy },
    });
    await notifyAuthor(
      t,
      updated,
      'CONTRIBUTION VERIFIED',
      `${updated.title} — verified.`,
      `contribution:${contribution.id}:reviewed`,
    );
    return updated;
  });
}

/** Reject a submitted contribution with a reason the author can read. */
export async function rejectContribution(
  ctx: ServiceContext,
  input: z.input<typeof rejectContributionSchema>,
): Promise<ContributionRecord> {
  const data = parseInput(rejectContributionSchema, input);
  const { contribution, project } = await loadContribution(ctx, data.contributionId);
  await requireReviewer(ctx, contribution, project);
  if (contribution.status !== 'submitted') {
    throw new InvalidStateError(`This contribution is already ${contribution.status}.`);
  }
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [updated] = await t.db
      .update(contributions)
      .set({
        status: 'rejected',
        reviewedByUserId: t.actor.kind === 'user' ? t.actor.userId : null,
        reviewedAt: now,
        reviewNote: data.reason,
        updatedAt: now,
      })
      .where(and(eq(contributions.id, contribution.id), eq(contributions.status, 'submitted')))
      .returning();
    if (!updated) throw new ConflictError('This contribution was reviewed in the meantime.');
    await recordAudit(t, {
      action: 'contribution.rejected',
      targetType: 'contribution',
      targetId: contribution.id,
      context: { memberId: contribution.memberId, reason: data.reason },
    });
    await publishEvent(t, {
      type: 'contribution.rejected',
      aggregateType: 'contribution',
      aggregateId: contribution.id,
      subjectMemberId: contribution.memberId,
      payload: contributionEventBase(updated, project),
    });
    await notifyAuthor(
      t,
      updated,
      'CONTRIBUTION REJECTED',
      `${updated.title} — ${data.reason}`,
      `contribution:${contribution.id}:reviewed`,
    );
    return updated;
  });
}

export interface ExternalContributionInput {
  memberId: string;
  projectId: string;
  kind: ContributionKind;
  title: string;
  url: string | null;
  /** Idempotency key, e.g. github:pr:owner/repo#12. */
  externalRef: string;
  occurredAt: Date;
  source: 'github' | 'system';
  /** Auto-verify (e.g. merged PR by a staff-verified GitHub account). */
  verified: boolean;
}

/**
 * Integration path (system actor only): record a contribution exactly once
 * per externalRef. Redelivered webhooks return `created: false`.
 */
export async function recordExternalContribution(
  ctx: ServiceContext,
  input: ExternalContributionInput,
): Promise<{ created: boolean; contribution: ContributionRecord | null }> {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError();
  const project = await findProject(ctx, input.projectId);
  return withTransaction(ctx, async (t) => {
    const now = t.clock.now();
    const [row] = await t.db
      .insert(contributions)
      .values({
        memberId: input.memberId,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title.slice(0, 200),
        url: input.url,
        source: input.source,
        externalRef: input.externalRef,
        status: input.verified ? 'verified' : 'submitted',
        verifiedAt: input.verified ? now : null,
        occurredAt: input.occurredAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: contributions.externalRef })
      .returning();
    if (!row) return { created: false, contribution: null };
    await publishEvent(t, {
      type: 'contribution.submitted',
      aggregateType: 'contribution',
      aggregateId: row.id,
      subjectMemberId: row.memberId,
      payload: { ...contributionEventBase(row, project), externalRef: row.externalRef },
    });
    if (input.verified) {
      const evidenceId = await insertContributionEvidence(t, row, now);
      await publishEvent(t, {
        type: 'contribution.verified',
        aggregateType: 'contribution',
        aggregateId: row.id,
        subjectMemberId: row.memberId,
        payload: {
          ...contributionEventBase(row, project),
          evidenceId,
          verifiedBy: input.source satisfies ContributionVerifier,
          automatic: true,
        },
      });
    }
    await notifyAuthor(
      t,
      row,
      input.verified ? 'CONTRIBUTION VERIFIED' : 'CONTRIBUTION RECORDED',
      input.verified ? `${row.title} — verified.` : `${row.title} — pending review.`,
      `contribution:${row.id}:recorded`,
    );
    return { created: true, contribution: row };
  });
}

export interface ContributionView {
  id: string;
  memberId: string;
  memberHandle: string;
  memberDisplayName: string;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  kind: ContributionKind;
  title: string;
  description: string | null;
  url: string | null;
  source: ContributionRecord['source'];
  status: ContributionRecord['status'];
  /** Only for the author and reviewers. */
  reviewNote: string | null;
  occurredAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

/**
 * Row-level visibility:
 *  - reviewers (canVerifyContributions) see everything
 *  - authors see their own
 *  - project owners/maintainers see their project's contributions
 *  - everyone else sees VERIFIED contributions of visible profiles on
 *    visible projects (or with no project)
 */
function visibilityFilter(ctx: ServiceContext, managed: readonly string[]): SQL | undefined {
  if (can(ctx, 'canVerifyContributions')) return undefined;
  const viewerMemberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  const profileVisible =
    ctx.actor.kind === 'user' && can(ctx, 'canViewMembers')
      ? inArray(members.profileVisibility, ['public', 'members'])
      : eq(members.profileVisibility, 'public');
  const visibleProjects = visibleProjectsFilter(ctx);
  const projectVisible = or(
    isNull(contributions.projectId),
    inArray(
      contributions.projectId,
      ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(isNull(projects.deletedAt), visibleProjects)),
    ),
  )!;
  const conditions: SQL[] = [
    and(eq(contributions.status, 'verified'), profileVisible, projectVisible)!,
  ];
  if (viewerMemberId) conditions.push(eq(contributions.memberId, viewerMemberId));
  if (managed.length > 0) conditions.push(inArray(contributions.projectId, [...managed]));
  return or(...conditions);
}

export async function listContributions(
  ctx: ServiceContext,
  input: z.input<typeof listContributionsSchema>,
): Promise<Page<ContributionView>> {
  const q = parseInput(listContributionsSchema, input);
  const managed = await managedProjectIds(ctx);
  const filters: SQL[] = [isNull(members.deletedAt)];
  const visible = visibilityFilter(ctx, managed);
  if (visible) filters.push(visible);
  if (q.memberId) filters.push(eq(contributions.memberId, q.memberId));
  if (q.projectId) filters.push(eq(contributions.projectId, q.projectId));
  if (q.status) filters.push(eq(contributions.status, q.status));
  if (q.kind) filters.push(eq(contributions.kind, q.kind));
  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        contribution: contributions,
        memberHandle: members.handle,
        memberDisplayName: members.displayName,
        projectSlug: projects.slug,
        projectTitle: projects.title,
      })
      .from(contributions)
      .innerJoin(members, eq(members.id, contributions.memberId))
      .leftJoin(projects, eq(projects.id, contributions.projectId))
      .where(where)
      .orderBy(desc(contributions.occurredAt), desc(contributions.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(contributions)
      .innerJoin(members, eq(members.id, contributions.memberId))
      .where(where),
  ]);

  const reviewer = can(ctx, 'canVerifyContributions');
  const items = rows.map(({ contribution: c, ...joined }) => {
    const privileged =
      reviewer ||
      isSelf(ctx.actor, c.memberId) ||
      (c.projectId !== null && managed.includes(c.projectId));
    return {
      id: c.id,
      memberId: c.memberId,
      memberHandle: joined.memberHandle,
      memberDisplayName: joined.memberDisplayName,
      projectId: c.projectId,
      projectSlug: joined.projectSlug,
      projectTitle: joined.projectTitle,
      kind: c.kind,
      title: c.title,
      description: c.description,
      url: c.url,
      source: c.source,
      status: c.status,
      reviewNote: privileged ? c.reviewNote : null,
      occurredAt: c.occurredAt,
      verifiedAt: c.verifiedAt,
      createdAt: c.createdAt,
    };
  });
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
