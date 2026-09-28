'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { projects, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { PROJECT_STATUS_LABELS, projectPath } from '@/lib/project-view';
import { runAction } from '@/server/actions';
import { nullableText, uuidField } from '@/server/projects/form-input';

const VISIBILITIES = ['public', 'members', 'private'] as const;
const DETAIL_FIELDS = [
  'title',
  'summary',
  'description',
  'goals',
  'domainKey',
  'visibility',
  'repoUrl',
  'websiteUrl',
] as const;

/** Every project page (list, detail tabs) re-renders with fresh data. */
function refreshProjects(): void {
  revalidatePath('/projects', 'layout');
}

function statusLabel(status: projects.ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status].toUpperCase();
}

export async function createProjectAction(_: ActionState, data: FormData): Promise<ActionState> {
  const result: { slug?: string } = {};
  const state = await runAction(
    'project.create',
    async (ctx) => {
      const created = await projects.createProject(ctx, {
        title: formString(data, 'title'),
        summary: formOptional(data, 'summary'),
        description: formOptional(data, 'description'),
        goals: formOptional(data, 'goals'),
        domainKey: formOptional(data, 'domainKey'),
        visibility: formEnum(data, 'visibility', VISIBILITIES) ?? 'members',
        repoUrl: formOptional(data, 'repoUrl'),
        websiteUrl: formOptional(data, 'websiteUrl'),
      });
      result.slug = created.slug;
      refreshProjects();
      return `PROJECT STARTED — ${created.title}.`;
    },
    { fieldNames: DETAIL_FIELDS },
  );
  if (state.status === 'success' && result.slug) redirect(`${projectPath(result.slug)}?created=1`);
  return state;
}

export async function updateProjectAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.update',
    async (ctx) => {
      const visibility = formEnum(data, 'visibility', VISIBILITIES);
      const updated = await projects.updateProject(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        title: formString(data, 'title'),
        summary: nullableText(data, 'summary'),
        description: nullableText(data, 'description'),
        goals: nullableText(data, 'goals'),
        domainKey: nullableText(data, 'domainKey'),
        repoUrl: nullableText(data, 'repoUrl'),
        websiteUrl: nullableText(data, 'websiteUrl'),
        ...(visibility ? { visibility } : {}),
      });
      refreshProjects();
      return `PROJECT UPDATED — ${updated.title}.`;
    },
    { fieldNames: DETAIL_FIELDS },
  );
}

export async function changeStatusAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.change_status',
    async (ctx) => {
      const status = formEnum(data, 'status', projects.PROJECT_STATUSES);
      if (!status || status === 'archived') {
        throw new ValidationError('Choose a status.', [
          { path: 'status', message: 'Choose a status.' },
        ]);
      }
      const updated = await projects.changeProjectStatus(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        status,
      });
      refreshProjects();
      return updated.status === 'shipped'
        ? `PROJECT SHIPPED — ${updated.title} — every active member is credited.`
        : `STATUS CHANGED — ${updated.title} — now ${statusLabel(updated.status)}.`;
    },
    { fieldNames: ['status'] },
  );
}

export async function archiveProjectAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('project.archive', async (ctx) => {
    const updated = await projects.changeProjectStatus(ctx, {
      projectId: uuidField(data, 'projectId', 'project'),
      status: 'archived',
    });
    refreshProjects();
    return `PROJECT ARCHIVED — ${updated.title} — frozen.`;
  });
}

export async function unarchiveProjectAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.unarchive',
    async (ctx) => {
      const restored = await projects.unarchiveProject(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        reason: formString(data, 'reason'),
      });
      refreshProjects();
      return `PROJECT RESTORED — ${restored.title} — now ${statusLabel(restored.status)}.`;
    },
    { fieldNames: ['reason'] },
  );
}

export async function linkRepoAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.link_repo',
    async (ctx) => {
      const repo = nullableText(data, 'repo');
      const updated = await projects.linkGithubRepo(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        repo,
      });
      refreshProjects();
      return updated.githubRepo
        ? `REPOSITORY LINKED — ${updated.githubRepo}.`
        : 'REPOSITORY UNLINKED.';
    },
    { fieldNames: ['repo'] },
  );
}
