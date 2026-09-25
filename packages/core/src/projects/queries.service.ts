import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { domainEvents, members, projectMembers, projects, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import type { DomainEventType } from '../events/catalog';
import {
  type ProjectAccess,
  type ProjectRecord,
  type ProjectRole,
  profileVisibleTo,
  resolveAccess,
  visibleProjectsFilter,
} from './access';
import { listProjectLinks, type ProjectLinkRecord } from './links.service';
import { listMilestones, type MilestoneRecord } from './milestones.service';
import { likePattern } from './schemas';
import { SLUG_PATTERN } from './slug';
import { PROJECT_STATUSES, type ProjectStatus } from './status';

/** Owner-first display order for member lists. */
const ROLE_ORDER: Readonly<Record<ProjectRole, number>> = {
  owner: 0,
  maintainer: 1,
  contributor: 2,
};

/**
 * project.shipped is emitted once per member (for achievements); the feed
 * already shows the single project.status_changed that caused it.
 */
const FEED_EXCLUDED_TYPES: readonly DomainEventType[] = ['project.shipped'];

export interface PersonRef {
  memberId: string;
  handle: string;
  displayName: string;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: ProjectStatus;
  visibility: ProjectRecord['visibility'];
  domainKey: string | null;
  githubRepo: string | null;
  /** Null when the owner's profile is hidden from this viewer. */
  owner: PersonRef | null;
  memberCount: number;
  shippedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMemberView extends PersonRef {
  role: ProjectRole;
  joinedAt: Date;
}

export interface ProjectViewerRights {
  role: ProjectRole | null;
  canEdit: boolean;
  canAdmin: boolean;
  isStaff: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  goals: string | null;
  repoUrl: string | null;
  websiteUrl: string | null;
  members: ProjectMemberView[];
  /** Members whose profiles are hidden from this viewer (counted, not named). */
  hiddenMemberCount: number;
  links: Pick<ProjectLinkRecord, 'id' | 'label' | 'url' | 'ordinal'>[];
  milestones: MilestoneRecord[];
  viewer: ProjectViewerRights;
}

export const getProjectSchema = z.union([
  z.object({ projectId: z.uuid() }),
  z.object({ slug: z.string().toLowerCase().max(64).regex(SLUG_PATTERN) }),
]);

async function findByRef(
  ctx: ServiceContext,
  ref: z.infer<typeof getProjectSchema>,
): Promise<ProjectRecord | null> {
  const condition =
    'projectId' in ref ? eq(projects.id, ref.projectId) : eq(projects.slug, ref.slug);
  const [row] = await ctx.db
    .select()
    .from(projects)
    .where(and(condition, isNull(projects.deletedAt)));
  return row ?? null;
}

async function loadMembers(ctx: ServiceContext, access: ProjectAccess) {
  const rows = await ctx.db
    .select({
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
      profileVisibility: members.profileVisibility,
      role: projectMembers.role,
      joinedAt: projectMembers.joinedAt,
    })
    .from(projectMembers)
    .innerJoin(members, eq(members.id, projectMembers.memberId))
    .where(
      and(
        eq(projectMembers.projectId, access.project.id),
        isNull(projectMembers.leftAt),
        isNull(members.deletedAt),
      ),
    )
    .orderBy(asc(projectMembers.joinedAt));
  // Collaborators always see each other; everyone else respects profile privacy.
  const insider = access.staff || access.role !== null;
  const visible = rows.filter(
    (row) => insider || profileVisibleTo(ctx, row.memberId, row.profileVisibility),
  );
  visible.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  return {
    members: visible.map(({ profileVisibility: _hidden, ...member }) => member),
    hiddenMemberCount: rows.length - visible.length,
  };
}

/** Full project page for the viewer. Invisible projects are reported as not found. */
export async function getProject(
  ctx: ServiceContext,
  input: z.input<typeof getProjectSchema>,
): Promise<ProjectDetail> {
  const ref = parseInput(getProjectSchema, input);
  const project = await findByRef(ctx, ref);
  if (!project) throw new NotFoundError('Project');
  const access = await resolveAccess(ctx, project);
  if (!access.canView) throw new NotFoundError('Project');

  const [team, links, milestones] = await Promise.all([
    loadMembers(ctx, access),
    listProjectLinks(ctx, project.id),
    listMilestones(ctx, project.id),
  ]);
  const ownerRow = team.members.find((member) => member.role === 'owner');
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    description: project.description,
    goals: project.goals,
    status: project.status,
    visibility: project.visibility,
    domainKey: project.domainKey,
    githubRepo: project.githubRepo,
    repoUrl: project.repoUrl,
    websiteUrl: project.websiteUrl,
    owner: ownerRow
      ? { memberId: ownerRow.memberId, handle: ownerRow.handle, displayName: ownerRow.displayName }
      : null,
    memberCount: team.members.length + team.hiddenMemberCount,
    members: team.members,
    hiddenMemberCount: team.hiddenMemberCount,
    links: links.map(({ id, label, url, ordinal }) => ({ id, label, url, ordinal })),
    milestones,
    shippedAt: project.shippedAt,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    viewer: {
      role: access.role,
      canEdit: access.canManage && project.status !== 'archived',
      canAdmin: access.canAdmin,
      isStaff: access.staff,
    },
  };
}

export const listProjectsSchema = pageSchema.extend({
  status: z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]).optional(),
  visibility: z.enum(['public', 'members', 'private']).optional(),
  /** Projects this member actively belongs to. */
  memberId: z.uuid().optional(),
  ownerMemberId: z.uuid().optional(),
  domainKey: z.string().max(32).optional(),
  search: z.string().trim().max(64).optional(),
  /** Archived projects are hidden unless requested (or status=archived). */
  includeArchived: z.boolean().default(false),
  sort: z.enum(['updated_desc', 'created_desc', 'title']).default('updated_desc'),
});

/** Paginated project directory, filtered to what the viewer may see. */
export async function listProjects(
  ctx: ServiceContext,
  input: z.input<typeof listProjectsSchema>,
): Promise<Page<ProjectSummary>> {
  const q = parseInput(listProjectsSchema, input);
  const filters: SQL[] = [isNull(projects.deletedAt)];
  const visible = visibleProjectsFilter(ctx);
  if (visible) filters.push(visible);
  if (q.status) filters.push(eq(projects.status, q.status));
  else if (!q.includeArchived) filters.push(ne(projects.status, 'archived'));
  if (q.visibility) filters.push(eq(projects.visibility, q.visibility));
  if (q.domainKey) filters.push(eq(projects.domainKey, q.domainKey));
  if (q.ownerMemberId) filters.push(eq(projects.ownerMemberId, q.ownerMemberId));
  if (q.memberId) {
    filters.push(
      inArray(
        projects.id,
        ctx.db
          .select({ id: projectMembers.projectId })
          .from(projectMembers)
          .where(and(eq(projectMembers.memberId, q.memberId), isNull(projectMembers.leftAt))),
      ),
    );
  }
  if (q.search) {
    const pattern = likePattern(q.search);
    filters.push(
      or(
        ilike(projects.title, pattern),
        ilike(projects.summary, pattern),
        ilike(projects.slug, pattern),
      )!,
    );
  }
  const where = and(...filters);
  const order =
    q.sort === 'title'
      ? [asc(projects.title), asc(projects.id)]
      : q.sort === 'created_desc'
        ? [desc(projects.createdAt), desc(projects.id)]
        : [desc(projects.updatedAt), desc(projects.id)];

  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        project: projects,
        ownerHandle: members.handle,
        ownerDisplayName: members.displayName,
        ownerVisibility: members.profileVisibility,
        memberCount: sql<number>`(select count(*)::int from project_members pm where pm.project_id = ${projects.id} and pm.left_at is null)`,
      })
      .from(projects)
      .innerJoin(members, eq(members.id, projects.ownerMemberId))
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(projects)
      .where(where),
  ]);

  const items = rows.map(
    ({ project, ownerHandle, ownerDisplayName, ownerVisibility, memberCount }) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      summary: project.summary,
      status: project.status,
      visibility: project.visibility,
      domainKey: project.domainKey,
      githubRepo: project.githubRepo,
      owner: profileVisibleTo(ctx, project.ownerMemberId, ownerVisibility)
        ? { memberId: project.ownerMemberId, handle: ownerHandle, displayName: ownerDisplayName }
        : null,
      memberCount,
      shippedAt: project.shippedAt,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }),
  );
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

export interface ProjectActivityItem {
  id: number;
  type: string;
  occurredAt: Date;
  /** Null for system/integration events or when the actor's profile is hidden. */
  actor: PersonRef | null;
  payload: Record<string, unknown>;
}

export const projectActivitySchema = pageSchema.extend({ projectId: z.uuid() });

/** Activity feed built from the project's domain events, newest first. */
export async function getProjectActivity(
  ctx: ServiceContext,
  input: z.input<typeof projectActivitySchema>,
): Promise<Page<ProjectActivityItem>> {
  const q = parseInput(projectActivitySchema, input);
  const project = await findByRef(ctx, { projectId: q.projectId });
  if (!project) throw new NotFoundError('Project');
  const access = await resolveAccess(ctx, project);
  if (!access.canView) throw new NotFoundError('Project');

  const where = and(
    eq(domainEvents.aggregateType, 'project'),
    eq(domainEvents.aggregateId, project.id),
    sql`${domainEvents.type} not in (${sql.join(
      FEED_EXCLUDED_TYPES.map((type) => sql`${type}`),
      sql`, `,
    )})`,
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        id: domainEvents.id,
        type: domainEvents.type,
        occurredAt: domainEvents.occurredAt,
        payload: domainEvents.payload,
        actorMemberId: members.id,
        actorHandle: members.handle,
        actorDisplayName: members.displayName,
        actorVisibility: members.profileVisibility,
      })
      .from(domainEvents)
      .leftJoin(users, eq(users.id, domainEvents.actorUserId))
      .leftJoin(members, eq(members.userId, users.id))
      .where(where)
      .orderBy(desc(domainEvents.occurredAt), desc(domainEvents.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(domainEvents)
      .where(where),
  ]);
  const insider = access.staff || access.role !== null;
  const items = rows.map((row) => {
    const showActor =
      row.actorMemberId !== null &&
      row.actorVisibility !== null &&
      (insider || profileVisibleTo(ctx, row.actorMemberId, row.actorVisibility));
    return {
      id: row.id,
      type: row.type,
      occurredAt: row.occurredAt,
      actor:
        showActor && row.actorMemberId && row.actorHandle && row.actorDisplayName
          ? {
              memberId: row.actorMemberId,
              handle: row.actorHandle,
              displayName: row.actorDisplayName,
            }
          : null,
      payload: row.payload,
    };
  });
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}
