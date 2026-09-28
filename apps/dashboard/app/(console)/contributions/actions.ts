'use server';

import { revalidatePath } from 'next/cache';
import { projects, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { CONTRIBUTION_KIND_LABELS, type ContributionKindKey } from '@/lib/project-view';
import { runAction } from '@/server/actions';
import { dateField, uuidField } from '@/server/projects/form-input';

const KINDS = Object.keys(CONTRIBUTION_KIND_LABELS) as ContributionKindKey[];
const RECORD_FIELDS = ['projectId', 'kind', 'title', 'description', 'url', 'occurredAt'] as const;

function refresh(): void {
  revalidatePath('/contributions');
  revalidatePath('/projects', 'layout');
}

export async function recordContributionAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'contribution.record',
    async (ctx) => {
      const kind = formEnum(data, 'kind', KINDS);
      if (!kind) {
        throw new ValidationError('Choose a kind.', [{ path: 'kind', message: 'Choose a kind.' }]);
      }
      const projectId = formOptional(data, 'projectId');
      const recorded = await projects.recordContribution(ctx, {
        projectId: projectId === undefined ? undefined : uuidField(data, 'projectId', 'project'),
        kind,
        title: formString(data, 'title'),
        description: formOptional(data, 'description'),
        url: formOptional(data, 'url'),
        occurredAt: dateField(data, 'occurredAt'),
      });
      refresh();
      return `CONTRIBUTION RECORDED — ${recorded.title} — awaiting review by someone else.`;
    },
    { fieldNames: RECORD_FIELDS },
  );
}

export async function verifyContributionAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'contribution.verify',
    async (ctx) => {
      const verified = await projects.verifyContribution(ctx, {
        contributionId: uuidField(data, 'contributionId', 'contribution'),
        note: formOptional(data, 'note'),
      });
      refresh();
      return `CONTRIBUTION VERIFIED — ${verified.title} — accepted as evidence.`;
    },
    { fieldNames: ['note'] },
  );
}

export async function rejectContributionAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'contribution.reject',
    async (ctx) => {
      const rejected = await projects.rejectContribution(ctx, {
        contributionId: uuidField(data, 'contributionId', 'contribution'),
        reason: formString(data, 'reason'),
      });
      refresh();
      return `CONTRIBUTION REJECTED — ${rejected.title} — the author sees your reason.`;
    },
    { fieldNames: ['reason'] },
  );
}
