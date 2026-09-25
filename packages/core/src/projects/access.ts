import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { type members, type projectMemberRole, projectMembers, projects } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { authorize, can, requireMember } from '../permissions/authorize';

export type ProjectRecord = typeof projects.$inferSelect;
export type ProjectRole = (typeof projectMemberRole.enumValues)[number];
export type ProjectVisibility = ProjectRecord['visibility'];
type ProfileVisibility = (typeof members.$inferSelect)['profileVisibility'];
type MemberStanding = (typeof members.$inferSelect)['standing'];

export const MANAGER_ROLES: readonly ProjectRole[] = ['owner', 'maintainer'];

/** What the current actor may do with one project. */
export interface ProjectAccess {
  project: ProjectRecord;
  /** Active membership role of the actor, if any. */
  role: ProjectRole | null;
  /** Holds canManageProjects. */
  staff: boolean;
  canView: boolean;
  /** Edit details, links, milestones, status; add/remove contributors. */
  canManage: boolean;
  /** Owner-level: visibility, archive, roles, ownership. */
  canAdmin: boolean;
}

/**
 * Membership-derived rights require good standing: quarantined and banned
 * members lose them entirely, restricted members keep read access only.
 */
function membershipCanRead(ctx: ServiceContext): boolean {
  return (
    ctx.actor.kind === 'user' &&
    ctx.actor.standing !== 'banned' &&
    ctx.actor.standing !== 'quarantined'
  );
}

function membershipCanAct(ctx: ServiceContext): boolean {
  return ctx.actor.kind === 'user' && ctx.actor.standing === 'good';
}

/** A member in good standing (the baseline for creating and contributing). */
export function requireActiveMember(ctx: ServiceContext): UserActor & { memberId: string } {
  const actor = requireMember(ctx);
  if (actor.standing !== 'good') {
    throw new ForbiddenError('Your account standing does not allow this right now.');
  }
  return actor;
}

export async function findProject(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
  return row ?? null;
}

export async function activeRole(
  ctx: ServiceContext,
  projectId: string,
  memberId: string,
): Promise<ProjectRole | null> {
  const [row] = await ctx.db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.leftAt),
      ),
    );
  return row?.role ?? null;
}

/** Visibility rule, shared by single reads and list filters. */
export function canViewProject(
  ctx: ServiceContext,
  visibility: ProjectVisibility,
  role: ProjectRole | null,
): boolean {
  if (can(ctx, 'canManageProjects')) return true;
  if (role && membershipCanRead(ctx)) return true;
  switch (visibility) {
    case 'public':
      return true;
    case 'members':
      return ctx.actor.kind === 'user' && can(ctx, 'canViewMembers');
    case 'private':
      return false;
  }
}

export async function resolveAccess(
  ctx: ServiceContext,
  project: ProjectRecord,
): Promise<ProjectAccess> {
  const memberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  const role = memberId ? await activeRole(ctx, project.id, memberId) : null;
  const staff = can(ctx, 'canManageProjects');
  const acting = role !== null && membershipCanAct(ctx);
  return {
    project,
    role,
    staff,
    canView: canViewProject(ctx, project.visibility, role),
    canManage: staff || (acting && role !== null && MANAGER_ROLES.includes(role)),
    canAdmin: staff || (acting && role === 'owner'),
  };
}

/**
 * Load a project the actor may see. Invisible projects are reported as not
 * found so private projects never leak their existence (no IDOR oracle).
 */
export async function loadVisibleProject(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await findProject(ctx, projectId);
  if (!project) throw new NotFoundError('Project');
  const access = await resolveAccess(ctx, project);
  if (!access.canView) throw new NotFoundError('Project');
  return access;
}

/** Owner/maintainer or canManageProjects. Denials are audited via authorize(). */
export async function requireManage(ctx: ServiceContext, access: ProjectAccess): Promise<void> {
  if (access.canManage) return;
  await authorize(ctx, 'canManageProjects', { type: 'project', id: access.project.id });
}

/** Owner or canManageProjects. Denials are audited via authorize(). */
export async function requireAdmin(ctx: ServiceContext, access: ProjectAccess): Promise<void> {
  if (access.canAdmin) return;
  await authorize(ctx, 'canManageProjects', { type: 'project', id: access.project.id });
}

export async function loadManageableProject(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectAccess> {
  const access = await loadVisibleProject(ctx, projectId);
  await requireManage(ctx, access);
  assertNotArchived(access.project);
  return access;
}

/**
 * Row-lock the project for the rest of the transaction. Serializes writers
 * that enforce per-project caps (members, links, milestones).
 */
export async function lockProject(ctx: ServiceContext, projectId: string): Promise<void> {
  await ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update');
}

export function assertNotArchived(project: ProjectRecord): void {
  if (project.status === 'archived') {
    throw new InvalidStateError('This project is archived. Staff can restore it.');
  }
}

/**
 * SQL filter for projects the actor may see (undefined = everything).
 * Mirrors canViewProject for list queries.
 */
export function visibleProjectsFilter(ctx: ServiceContext): SQL | undefined {
  if (can(ctx, 'canManageProjects')) return undefined;
  const conditions: SQL[] = [eq(projects.visibility, 'public')];
  if (ctx.actor.kind === 'user' && can(ctx, 'canViewMembers')) {
    conditions.push(eq(projects.visibility, 'members'));
  }
  const memberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  if (memberId && membershipCanRead(ctx)) {
    conditions.push(
      inArray(
        projects.id,
        ctx.db
          .select({ id: projectMembers.projectId })
          .from(projectMembers)
          .where(and(eq(projectMembers.memberId, memberId), isNull(projectMembers.leftAt))),
      ),
    );
  }
  return or(...conditions);
}

/** Project IDs the actor manages through membership (owner/maintainer, good standing). */
export async function managedProjectIds(ctx: ServiceContext): Promise<string[]> {
  const memberId = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  if (!memberId || !membershipCanAct(ctx)) return [];
  const rows = await ctx.db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.leftAt),
        inArray(projectMembers.role, [...MANAGER_ROLES]),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Member-profile privacy for names shown on project pages. Mirrors
 * identity's profile rule: yourself and canViewPrivateProfiles always; a
 * banned member's profile is hidden from everyone else; otherwise the
 * member's chosen profile visibility decides.
 */
export function profileVisibleTo(
  ctx: ServiceContext,
  member: { memberId: string; visibility: ProfileVisibility; standing: MemberStanding },
): boolean {
  if (ctx.actor.kind === 'user' && ctx.actor.memberId === member.memberId) return true;
  if (can(ctx, 'canViewPrivateProfiles')) return true;
  if (member.standing === 'banned') return false;
  switch (member.visibility) {
    case 'public':
      return true;
    case 'members':
      return ctx.actor.kind === 'user' && can(ctx, 'canViewMembers');
    case 'staff':
      return false;
  }
}
