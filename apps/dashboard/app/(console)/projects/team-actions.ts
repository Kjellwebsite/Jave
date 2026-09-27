'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getProfile, projects, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional } from '@/lib/form-data';
import { PROJECT_ROLE_LABELS } from '@/lib/project-view';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { handleField, uuidField } from '@/server/projects/form-input';

const ASSIGNABLE_ROLES = ['maintainer', 'contributor'] as const;

function refreshProjects(): void {
  revalidatePath('/projects', 'layout');
}

function roleOf(data: FormData): (typeof ASSIGNABLE_ROLES)[number] {
  const role = formEnum(data, 'role', ASSIGNABLE_ROLES);
  if (!role)
    throw new ValidationError('Choose a role.', [{ path: 'role', message: 'Choose a role.' }]);
  return role;
}

/**
 * A teammate's display name for the result message. Read from the project
 * team (collaborators always see each other there), never from the profile,
 * which a teammate may have made staff-only.
 */
async function teammateName(ctx: UserContext, projectId: string, memberId: string) {
  const detail = await projects.getProject(ctx, { projectId });
  return detail.members.find((member) => member.memberId === memberId)?.displayName ?? 'Member';
}

export async function addMemberAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.add_member',
    async (ctx) => {
      const projectId = uuidField(data, 'projectId', 'project');
      const profile = await getProfile(ctx, { handle: handleField(data, 'handle') });
      const role = roleOf(data);
      await projects.addProjectMember(ctx, { projectId, memberId: profile.memberId, role });
      refreshProjects();
      return `MEMBER ADDED — ${profile.displayName} — ${PROJECT_ROLE_LABELS[role].toUpperCase()}. They were notified.`;
    },
    { fieldNames: ['handle', 'role'] },
  );
}

export async function changeMemberRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.change_member_role',
    async (ctx) => {
      const projectId = uuidField(data, 'projectId', 'project');
      const memberId = uuidField(data, 'memberId', 'member');
      const role = roleOf(data);
      await projects.changeProjectMemberRole(ctx, { projectId, memberId, role });
      refreshProjects();
      return `ROLE CHANGED — ${await teammateName(ctx, projectId, memberId)} — ${PROJECT_ROLE_LABELS[role].toUpperCase()}.`;
    },
    { fieldNames: ['role'] },
  );
}

export async function removeMemberAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.remove_member',
    async (ctx) => {
      const projectId = uuidField(data, 'projectId', 'project');
      const memberId = uuidField(data, 'memberId', 'member');
      const name = await teammateName(ctx, projectId, memberId);
      await projects.removeProjectMember(ctx, {
        projectId,
        memberId,
        reason: formOptional(data, 'reason'),
      });
      refreshProjects();
      return `MEMBER REMOVED — ${name}.`;
    },
    { fieldNames: ['reason'] },
  );
}

export async function transferOwnershipAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('project.transfer_ownership', async (ctx) => {
    const projectId = uuidField(data, 'projectId', 'project');
    const memberId = uuidField(data, 'memberId', 'member');
    await projects.transferProjectOwnership(ctx, { projectId, memberId });
    refreshProjects();
    return `OWNERSHIP TRANSFERRED — ${await teammateName(ctx, projectId, memberId)} now owns the project. The previous owner is a maintainer.`;
  });
}

export async function leaveProjectAction(_: ActionState, data: FormData): Promise<ActionState> {
  const state = await runAction('project.leave', async (ctx) => {
    await projects.leaveProject(ctx, { projectId: uuidField(data, 'projectId', 'project') });
    refreshProjects();
    return 'You left the project.';
  });
  // A private project is invisible once you leave it: go back to the directory.
  if (state.status === 'success') redirect('/projects?scope=mine');
  return state;
}
