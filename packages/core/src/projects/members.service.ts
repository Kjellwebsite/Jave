import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { members, projectMembers, projects } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { requireMember } from '../permissions/authorize';
import {
  activeRole,
  assertNotArchived,
  loadManageableProject,
  loadVisibleProject,
  lockProject,
  type ProjectAccess,
  type ProjectRecord,
  type ProjectRole,
  requireAdmin,
} from './access';
import { projectEventBase } from './projects.service';
import { projectUrl, userIdOfMember } from './recipients';
import { singleLine } from './schemas';

/** Hard ceiling on active members per project. */
export const MAX_PROJECT_MEMBERS = 50;

const ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  owner: 'OWNER',
  maintainer: 'MAINTAINER',
  contributor: 'CONTRIBUTOR',
};

/** Roles that can be granted directly. Ownership moves only via transferProjectOwnership. */
const assignableRole = z.enum(['maintainer', 'contributor']);

export const addProjectMemberSchema = z.object({
  projectId: z.uuid(),
  memberId: z.uuid(),
  role: assignableRole.default('contributor'),
});

export const removeProjectMemberSchema = z.object({
  projectId: z.uuid(),
  memberId: z.uuid(),
  reason: singleLine(500, 0).optional(),
});

export const changeProjectMemberRoleSchema = z.object({
  projectId: z.uuid(),
  memberId: z.uuid(),
  role: assignableRole,
});

export const transferOwnershipSchema = z.object({
  projectId: z.uuid(),
  /** Must already be an active member of the project. */
  memberId: z.uuid(),
});

export const leaveProjectSchema = z.object({ projectId: z.uuid() });

/**
 * Maintainers (without staff rights) manage contributors only; owners and
 * staff manage everyone below owner.
 */
function assertCanManageRole(access: ProjectAccess, targetRole: ProjectRole): void {
  if (access.canAdmin) return;
  if (targetRole !== 'contributor') {
    throw new ForbiddenError('Maintainers can only manage contributors.');
  }
}

async function loadTargetMember(ctx: ServiceContext, memberId: string) {
  const [row] = await ctx.db
    .select({ id: members.id, userId: members.userId, standing: members.standing })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!row) throw new NotFoundError('Member');
  return row;
}

async function notifyMember(
  ctx: ServiceContext,
  project: ProjectRecord,
  memberId: string,
  body: string,
  dedupeKey: string,
): Promise<void> {
  const userId = await userIdOfMember(ctx, memberId);
  if (!userId) return;
  await notify(ctx, {
    recipientUserId: userId,
    type: 'project.updated',
    title: 'PROJECT ACCESS',
    body,
    url: projectUrl(ctx, project.slug),
    data: { projectId: project.id },
    dedupeKey,
  });
}

/** Add a member (maintainer/contributor). Rejoining reactivates the previous row. */
export async function addProjectMember(
  ctx: ServiceContext,
  input: z.input<typeof addProjectMemberSchema>,
) {
  const data = parseInput(addProjectMemberSchema, input);
  const access = await loadManageableProject(ctx, data.projectId);
  assertCanManageRole(access, data.role);
  const target = await loadTargetMember(ctx, data.memberId);
  if (target.standing === 'banned' || target.standing === 'quarantined') {
    throw new InvalidStateError('That member cannot join projects right now.');
  }
  const { project } = access;

  return withTransaction(ctx, async (t) => {
    // Serialize membership changes per project (member cap + one-row-per-member).
    await lockProject(t, project.id);
    const [existing] = await t.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.memberId, target.id)));
    if (existing && existing.leftAt === null) {
      throw new ConflictError('That member is already on this project.');
    }
    const [active] = await t.db
      .select({ value: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), isNull(projectMembers.leftAt)));
    if ((active?.value ?? 0) >= MAX_PROJECT_MEMBERS) {
      throw new ConflictError(`Projects are capped at ${MAX_PROJECT_MEMBERS} members.`);
    }
    const now = t.clock.now();
    const [row] = existing
      ? await t.db
          .update(projectMembers)
          .set({ role: data.role, joinedAt: now, leftAt: null })
          .where(eq(projectMembers.id, existing.id))
          .returning()
      : await t.db
          .insert(projectMembers)
          .values({ projectId: project.id, memberId: target.id, role: data.role, joinedAt: now })
          .returning();
    await recordAudit(t, {
      action: 'project.member_added',
      targetType: 'project',
      targetId: project.id,
      context: { memberId: target.id, role: data.role },
    });
    const eventId = await publishEvent(t, {
      type: 'project.member_added',
      aggregateType: 'project',
      aggregateId: project.id,
      subjectMemberId: target.id,
      payload: { ...projectEventBase(project), memberId: target.id, role: data.role },
    });
    await notifyMember(
      t,
      project,
      target.id,
      `${project.title} — you were added as ${ROLE_LABELS[data.role]}.`,
      `project:${project.id}:member:${eventId}`,
    );
    return row!;
  });
}

async function deactivateMembership(
  ctx: ServiceContext,
  project: ProjectRecord,
  memberId: string,
  context: { reason?: string; self: boolean },
): Promise<void> {
  const now = ctx.clock.now();
  const [left] = await ctx.db
    .update(projectMembers)
    .set({ leftAt: now })
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.leftAt),
      ),
    )
    .returning({ role: projectMembers.role });
  if (!left) throw new ConflictError('That member is no longer on this project.');
  await recordAudit(ctx, {
    action: context.self ? 'project.member_left' : 'project.member_removed',
    targetType: 'project',
    targetId: project.id,
    context: { memberId, role: left.role, reason: context.reason ?? null },
  });
  const eventId = await publishEvent(ctx, {
    type: 'project.member_removed',
    aggregateType: 'project',
    aggregateId: project.id,
    subjectMemberId: memberId,
    payload: { ...projectEventBase(project), memberId, role: left.role, self: context.self },
  });
  if (!context.self) {
    await notifyMember(
      ctx,
      project,
      memberId,
      `${project.title} — you were removed from the project.`,
      `project:${project.id}:member:${eventId}`,
    );
  }
}

/** Remove a member. Owners must transfer ownership first. */
export async function removeProjectMember(
  ctx: ServiceContext,
  input: z.input<typeof removeProjectMemberSchema>,
): Promise<void> {
  const data = parseInput(removeProjectMemberSchema, input);
  const access = await loadManageableProject(ctx, data.projectId);
  const role = await activeRole(ctx, access.project.id, data.memberId);
  if (!role) throw new NotFoundError('Project member');
  if (role === 'owner') {
    throw new InvalidStateError('Transfer ownership before removing the owner.');
  }
  const self = ctx.actor.kind === 'user' && ctx.actor.memberId === data.memberId;
  if (!self) assertCanManageRole(access, role);
  await withTransaction(ctx, (t) =>
    deactivateMembership(t, access.project, data.memberId, { reason: data.reason, self }),
  );
}

/** Leave a project yourself. Works on archived projects too; owners transfer first. */
export async function leaveProject(
  ctx: ServiceContext,
  input: z.input<typeof leaveProjectSchema>,
): Promise<void> {
  const actor = requireMember(ctx);
  const data = parseInput(leaveProjectSchema, input);
  const { project } = await loadVisibleProject(ctx, data.projectId);
  const role = await activeRole(ctx, project.id, actor.memberId);
  if (!role) throw new NotFoundError('Project member');
  if (role === 'owner') {
    throw new InvalidStateError('Transfer ownership before leaving your project.');
  }
  await withTransaction(ctx, (t) =>
    deactivateMembership(t, project, actor.memberId, { self: true }),
  );
}

/** Promote/demote between maintainer and contributor (owner or staff). */
export async function changeProjectMemberRole(
  ctx: ServiceContext,
  input: z.input<typeof changeProjectMemberRoleSchema>,
) {
  const data = parseInput(changeProjectMemberRoleSchema, input);
  const access = await loadManageableProject(ctx, data.projectId);
  await requireAdmin(ctx, access);
  const { project } = access;
  const current = await activeRole(ctx, project.id, data.memberId);
  if (!current) throw new NotFoundError('Project member');
  if (current === 'owner') {
    throw new InvalidStateError('Ownership changes only through a transfer.');
  }
  if (current === data.role) return { memberId: data.memberId, role: current, changed: false };

  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(projectMembers)
      .set({ role: data.role })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.memberId, data.memberId),
          isNull(projectMembers.leftAt),
          eq(projectMembers.role, current),
        ),
      )
      .returning({ role: projectMembers.role });
    if (!row) throw new ConflictError('The membership changed in the meantime.');
    await recordAudit(t, {
      action: 'project.member_role_changed',
      targetType: 'project',
      targetId: project.id,
      context: { memberId: data.memberId, from: current, to: data.role },
    });
    const eventId = await publishEvent(t, {
      type: 'project.member_role_changed',
      aggregateType: 'project',
      aggregateId: project.id,
      subjectMemberId: data.memberId,
      payload: {
        ...projectEventBase(project),
        memberId: data.memberId,
        from: current,
        to: data.role,
      },
    });
    await notifyMember(
      t,
      project,
      data.memberId,
      `${project.title} — your role is now ${ROLE_LABELS[data.role]}.`,
      `project:${project.id}:member:${eventId}`,
    );
    return { memberId: data.memberId, role: data.role, changed: true };
  });
}

/**
 * Hand ownership to another active member in good standing (owner or staff).
 * The previous owner stays on as maintainer.
 */
export async function transferProjectOwnership(
  ctx: ServiceContext,
  input: z.input<typeof transferOwnershipSchema>,
): Promise<ProjectRecord> {
  const data = parseInput(transferOwnershipSchema, input);
  const access = await loadVisibleProject(ctx, data.projectId);
  await requireAdmin(ctx, access);
  const { project } = access;
  assertNotArchived(project);
  if (project.ownerMemberId === data.memberId) {
    throw new InvalidStateError('That member already owns this project.');
  }
  const targetRole = await activeRole(ctx, project.id, data.memberId);
  if (!targetRole) {
    throw new InvalidStateError('Add the member to the project before transferring ownership.');
  }
  const target = await loadTargetMember(ctx, data.memberId);
  if (target.standing !== 'good') {
    throw new InvalidStateError('Ownership can only go to a member in good standing.');
  }

  return withTransaction(ctx, async (t) => {
    const previousOwner = project.ownerMemberId;
    const [locked] = await t.db
      .select({ ownerMemberId: projects.ownerMemberId })
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('update');
    if (locked?.ownerMemberId !== previousOwner) {
      throw new ConflictError('Ownership changed in the meantime. Reload and try again.');
    }
    // Demote first: the partial unique index allows one active owner at a time.
    await t.db
      .update(projectMembers)
      .set({ role: 'maintainer' })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.role, 'owner'),
          isNull(projectMembers.leftAt),
        ),
      );
    const [promoted] = await t.db
      .update(projectMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.memberId, data.memberId),
          isNull(projectMembers.leftAt),
        ),
      )
      .returning({ id: projectMembers.id });
    if (!promoted) throw new ConflictError('That member left the project in the meantime.');
    const [updated] = await t.db
      .update(projects)
      .set({ ownerMemberId: data.memberId, updatedAt: t.clock.now() })
      .where(eq(projects.id, project.id))
      .returning();
    await recordAudit(t, {
      action: 'project.ownership_transferred',
      targetType: 'project',
      targetId: project.id,
      context: { from: previousOwner, to: data.memberId },
    });
    const eventId = await publishEvent(t, {
      type: 'project.ownership_transferred',
      aggregateType: 'project',
      aggregateId: project.id,
      subjectMemberId: data.memberId,
      payload: { ...projectEventBase(project), from: previousOwner, to: data.memberId },
    });
    await notifyMember(
      t,
      updated!,
      data.memberId,
      `${project.title} — you are now the owner.`,
      `project:${project.id}:owner:${eventId}:new`,
    );
    await notifyMember(
      t,
      updated!,
      previousOwner,
      `${project.title} — ownership transferred. You remain a maintainer.`,
      `project:${project.id}:owner:${eventId}:previous`,
    );
    return updated!;
  });
}
