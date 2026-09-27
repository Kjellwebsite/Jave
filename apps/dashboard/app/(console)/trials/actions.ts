'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, trials, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formBoolean, formEnum, formOptional, formString } from '@/lib/form-data';
import {
  formFacetKeys,
  formInteger,
  formRubric,
  formZonedDate,
  requiredInteger,
} from '@/lib/trial-form';
import { runAction } from '@/server/actions';
import { loadViewer } from '@/server/data/viewer';

const TRIAL_FIELDS = [
  'templateId',
  'title',
  'category',
  'summary',
  'brief',
  'rubric',
  'facetKeys',
  'durationMinutes',
  'teamSize',
  'maxParticipants',
  'recruitmentClosesAt',
  'scheduledStartAt',
  'adversarialEnabled',
];

const TEMPLATE_FIELDS = [
  'key',
  'title',
  'category',
  'summary',
  'brief',
  'rubric',
  'facetKeys',
  'durationMinutes',
  'teamSizeMin',
  'teamSizeMax',
  'allowsAdversarial',
];

function optionalUuid(data: FormData, name: string): string | undefined {
  const value = formOptional(data, name);
  if (value === undefined) return undefined;
  if (!isUuid(value))
    throw new ValidationError('Unknown item.', [{ path: name, message: 'unknown' }]);
  return value;
}

export async function createTrialAction(_: ActionState, data: FormData): Promise<ActionState> {
  const created: { trialId: string | null } = { trialId: null };
  const state = await runAction(
    'trial.create',
    async (ctx) => {
      const { timeZone } = await loadViewer(ctx);
      const trial = await trials.createTrial(ctx, {
        templateId: optionalUuid(data, 'templateId'),
        title: formString(data, 'title'),
        category: formEnum(data, 'category', trials.TRIAL_CATEGORIES),
        summary: formString(data, 'summary'),
        brief: formString(data, 'brief'),
        rubric: formRubric(data),
        facetKeys: formFacetKeys(data),
        durationMinutes: formInteger(data, 'durationMinutes'),
        teamSize: formInteger(data, 'teamSize'),
        maxParticipants: formInteger(data, 'maxParticipants') ?? null,
        recruitmentClosesAt: formZonedDate(data, 'recruitmentClosesAt', timeZone) ?? undefined,
        scheduledStartAt: formZonedDate(data, 'scheduledStartAt', timeZone) ?? undefined,
        adversarialEnabled: formBoolean(data, 'adversarialEnabled'),
      });
      created.trialId = trial.id;
      revalidatePath('/trials');
      return `TRIAL CREATED — ${trial.ref} — ${trial.title}.`;
    },
    { fieldNames: TRIAL_FIELDS },
  );
  if (state.status === 'success' && created.trialId) redirect(`/trials/${created.trialId}`);
  return state;
}

function templateInput(data: FormData) {
  return {
    title: formString(data, 'title'),
    category: formEnum(data, 'category', trials.TRIAL_CATEGORIES),
    summary: formString(data, 'summary'),
    brief: formString(data, 'brief'),
    rubric: formRubric(data),
    facetKeys: formFacetKeys(data),
    durationMinutes: formInteger(data, 'durationMinutes'),
    teamSizeMin: formInteger(data, 'teamSizeMin'),
    teamSizeMax: formInteger(data, 'teamSizeMax'),
  };
}

/** Only holders of canManageAdversarial see (and may submit) the switch; core re-checks. */
function adversarialFlag(data: FormData): { allowsAdversarial?: boolean } {
  return data.has('allowsAdversarialShown')
    ? { allowsAdversarial: formBoolean(data, 'allowsAdversarial') }
    : {};
}

export async function createTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  const outcome = { created: false };
  const state = await runAction(
    'trial.template_create',
    async (ctx) => {
      const input = templateInput(data);
      const category = input.category;
      if (!category)
        throw new ValidationError('Choose a category.', [
          { path: 'category', message: 'Choose a category.' },
        ]);
      const template = await trials.createTemplate(ctx, {
        ...input,
        category,
        durationMinutes: requiredInteger(data, 'durationMinutes'),
        key: formString(data, 'key').trim(),
        ...adversarialFlag(data),
      });
      outcome.created = true;
      revalidatePath('/trials/templates');
      return `TEMPLATE CREATED — ${template.title}.`;
    },
    { fieldNames: TEMPLATE_FIELDS },
  );
  if (state.status === 'success' && outcome.created) redirect('/trials/templates');
  return state;
}

export async function updateTemplateAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'trial.template_update',
    async (ctx) => {
      const templateId = optionalUuid(data, 'templateId');
      if (!templateId) throw new ValidationError('Unknown template.');
      const template = await trials.updateTemplate(ctx, {
        templateId,
        ...templateInput(data),
        ...adversarialFlag(data),
      });
      revalidatePath('/trials/templates');
      revalidatePath(`/trials/templates/${templateId}`);
      return `TEMPLATE SAVED — ${template.title}.`;
    },
    { fieldNames: TEMPLATE_FIELDS },
  );
}

export async function setTemplateActiveAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('trial.template_active', async (ctx) => {
    const templateId = optionalUuid(data, 'templateId');
    if (!templateId) throw new ValidationError('Unknown template.');
    const active = formString(data, 'active') === 'true';
    const template = active
      ? await trials.updateTemplate(ctx, { templateId, active: true })
      : await trials.deactivateTemplate(ctx, { templateId });
    revalidatePath('/trials/templates');
    revalidatePath(`/trials/templates/${templateId}`);
    return active
      ? `TEMPLATE REACTIVATED — ${template.title}.`
      : `TEMPLATE DEACTIVATED — ${template.title}. Trials created from it keep their snapshot.`;
  });
}

export async function seedTemplatesAction(_: ActionState): Promise<ActionState> {
  return runAction('trial.templates_seed', async (ctx) => {
    const result = await trials.seedStarterTemplates(ctx);
    revalidatePath('/trials/templates');
    return result.created.length > 0
      ? `STARTER TEMPLATES INSTALLED — ${result.created.length} added.`
      : 'Starter templates already installed. Nothing changed.';
  });
}
