'use server';

import { revalidatePath } from 'next/cache';
import { projects, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { MILESTONE_STATUS_LABELS } from '@/lib/project-view';
import { runAction } from '@/server/actions';
import { dateField, uuidField } from '@/server/projects/form-input';

const PLANNING_STATUSES = ['planned', 'active', 'dropped'] as const;

function refreshProjects(): void {
  revalidatePath('/projects', 'layout');
}

function refs(data: FormData) {
  return {
    projectId: uuidField(data, 'projectId', 'project'),
    milestoneId: uuidField(data, 'milestoneId', 'milestone'),
  };
}

export async function addMilestoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.add_milestone',
    async (ctx) => {
      const milestone = await projects.addMilestone(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        title: formString(data, 'title'),
        description: formOptional(data, 'description'),
        dueAt: dateField(data, 'dueAt'),
      });
      refreshProjects();
      return `MILESTONE ADDED — ${milestone.title}.`;
    },
    { fieldNames: ['title', 'description', 'dueAt'] },
  );
}

export async function setMilestoneStatusAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('project.milestone_status', async (ctx) => {
    const status = formEnum(data, 'status', PLANNING_STATUSES);
    if (!status) throw new ValidationError('Choose a status.');
    const milestone = await projects.updateMilestone(ctx, { ...refs(data), status });
    refreshProjects();
    return `MILESTONE ${MILESTONE_STATUS_LABELS[status].toUpperCase()} — ${milestone.title}.`;
  });
}

export async function completeMilestoneAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('project.complete_milestone', async (ctx) => {
    const milestone = await projects.completeMilestone(ctx, refs(data));
    refreshProjects();
    return `MILESTONE DONE — ${milestone.title}.`;
  });
}

export async function removeMilestoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('project.remove_milestone', async (ctx) => {
    await projects.removeMilestone(ctx, refs(data));
    refreshProjects();
    return 'MILESTONE REMOVED.';
  });
}

export async function addLinkAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'project.add_link',
    async (ctx) => {
      const link = await projects.addProjectLink(ctx, {
        projectId: uuidField(data, 'projectId', 'project'),
        label: formString(data, 'label'),
        url: formString(data, 'url'),
      });
      refreshProjects();
      return `LINK ADDED — ${link.label}.`;
    },
    { fieldNames: ['label', 'url'] },
  );
}

export async function removeLinkAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('project.remove_link', async (ctx) => {
    await projects.removeProjectLink(ctx, {
      projectId: uuidField(data, 'projectId', 'project'),
      linkId: uuidField(data, 'linkId', 'link'),
    });
    refreshProjects();
    return 'LINK REMOVED.';
  });
}
