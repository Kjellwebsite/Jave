import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { trialTemplates, type RubricCriterion } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize, can } from '../permissions/authorize';
import { isValidFacet, loadCatalog } from '../identity/ranks';
import type { TrialCategory } from './constants';
import type { TemplateRecord } from './repository';
import {
  createTemplateSchema,
  listTemplatesSchema,
  templateIdSchema,
  updateTemplateSchema,
} from './schemas';
import { STARTER_TEMPLATES } from './starter-templates';

export interface TemplateView {
  id: string;
  key: string;
  title: string;
  category: TrialCategory;
  summary: string;
  brief: string;
  durationMinutes: number;
  teamSizeMin: number;
  teamSizeMax: number;
  rubric: RubricCriterion[];
  facetKeys: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Present only for viewers who hold canManageAdversarial. */
  allowsAdversarial?: boolean;
}

function toTemplateView(ctx: ServiceContext, row: TemplateRecord): TemplateView {
  const view: TemplateView = {
    id: row.id,
    key: row.key,
    title: row.title,
    category: row.category,
    summary: row.summary,
    brief: row.brief,
    durationMinutes: row.durationMinutes,
    teamSizeMin: row.teamSizeMin,
    teamSizeMax: row.teamSizeMax,
    rubric: row.rubric,
    facetKeys: row.facetKeys,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (can(ctx, 'canManageAdversarial')) view.allowsAdversarial = row.allowsAdversarial;
  return view;
}

/** Facet keys must exist in the live capability catalog. */
export async function assertFacetKeys(
  ctx: ServiceContext,
  facetKeys: readonly string[],
): Promise<void> {
  if (facetKeys.length === 0) return;
  const catalog = await loadCatalog(ctx);
  for (const key of facetKeys) {
    if (!isValidFacet(catalog, key))
      throw new ValidationError(`Unknown capability facet "${key}".`, [
        { path: 'facetKeys', message: `unknown facet ${key}` },
      ]);
  }
}

export async function loadTemplate(ctx: ServiceContext, templateId: string) {
  const [row] = await ctx.db.select().from(trialTemplates).where(eq(trialTemplates.id, templateId));
  if (!row) throw new NotFoundError('Trial template');
  return row;
}

export async function createTemplate(
  ctx: ServiceContext,
  input: z.input<typeof createTemplateSchema>,
): Promise<TemplateView> {
  const data = parseInput(createTemplateSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial_template' });
  if (data.allowsAdversarial)
    await authorize(ctx, 'canManageAdversarial', { type: 'trial_template' });
  await assertFacetKeys(ctx, data.facetKeys);
  try {
    return await withTransaction(ctx, async (t) => {
      const [row] = await t.db
        .insert(trialTemplates)
        .values({ ...data, createdByUserId: actorUserId(t.actor) })
        .returning();
      await recordAudit(t, {
        action: 'trial.template_created',
        targetType: 'trial_template',
        targetId: row!.id,
        context: { key: data.key, category: data.category },
      });
      return toTemplateView(t, row!);
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError(`A template with key "${data.key}" already exists.`);
    throw error;
  }
}

export async function updateTemplate(
  ctx: ServiceContext,
  input: z.input<typeof updateTemplateSchema>,
): Promise<TemplateView> {
  const { templateId, ...patch } = parseInput(updateTemplateSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial_template', id: templateId });
  const current = await loadTemplate(ctx, templateId);
  if (
    patch.allowsAdversarial !== undefined &&
    patch.allowsAdversarial !== current.allowsAdversarial
  )
    await authorize(ctx, 'canManageAdversarial', { type: 'trial_template', id: templateId });
  const teamSizeMin = patch.teamSizeMin ?? current.teamSizeMin;
  const teamSizeMax = patch.teamSizeMax ?? current.teamSizeMax;
  if (teamSizeMin > teamSizeMax)
    throw new ValidationError('teamSizeMin must not exceed teamSizeMax.', [
      { path: 'teamSizeMax', message: 'below teamSizeMin' },
    ]);
  if (patch.facetKeys) await assertFacetKeys(ctx, patch.facetKeys);
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
    (key) =>
      patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
  );
  if (changed.length === 0) return toTemplateView(ctx, current);
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(trialTemplates)
      .set(patch)
      .where(eq(trialTemplates.id, templateId))
      .returning();
    await recordAudit(t, {
      action: 'trial.template_updated',
      targetType: 'trial_template',
      targetId: templateId,
      context: { fields: changed },
    });
    return toTemplateView(t, row!);
  });
}

export async function deactivateTemplate(
  ctx: ServiceContext,
  input: z.input<typeof templateIdSchema>,
): Promise<TemplateView> {
  const { templateId } = parseInput(templateIdSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial_template', id: templateId });
  const current = await loadTemplate(ctx, templateId);
  if (!current.active) return toTemplateView(ctx, current);
  return withTransaction(ctx, async (t) => {
    const [row] = await t.db
      .update(trialTemplates)
      .set({ active: false })
      .where(eq(trialTemplates.id, templateId))
      .returning();
    await recordAudit(t, {
      action: 'trial.template_deactivated',
      targetType: 'trial_template',
      targetId: templateId,
      context: { key: current.key },
    });
    return toTemplateView(t, row!);
  });
}

export async function getTemplate(
  ctx: ServiceContext,
  input: z.input<typeof templateIdSchema>,
): Promise<TemplateView> {
  const { templateId } = parseInput(templateIdSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial_template', id: templateId });
  return toTemplateView(ctx, await loadTemplate(ctx, templateId));
}

export async function listTemplates(
  ctx: ServiceContext,
  input: z.input<typeof listTemplatesSchema> = {},
): Promise<TemplateView[]> {
  const { includeInactive } = parseInput(listTemplatesSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial_template' });
  const rows = await ctx.db
    .select()
    .from(trialTemplates)
    .where(includeInactive ? undefined : eq(trialTemplates.active, true))
    .orderBy(asc(trialTemplates.category), asc(trialTemplates.title));
  return rows.map((row) => toTemplateView(ctx, row));
}

export interface SeedResult {
  created: string[];
  existing: string[];
}

/**
 * Install the curated starter templates. Idempotent: templates whose key
 * already exists are left untouched (staff edits are never overwritten).
 */
export async function seedStarterTemplates(ctx: ServiceContext): Promise<SeedResult> {
  await authorize(ctx, 'canManageTrials', { type: 'trial_template' });
  const templates = STARTER_TEMPLATES.map((template) => parseInput(createTemplateSchema, template));
  for (const template of templates) await assertFacetKeys(ctx, template.facetKeys);
  return withTransaction(ctx, async (t) => {
    const created: string[] = [];
    for (const template of templates) {
      const rows = await t.db
        .insert(trialTemplates)
        .values({ ...template, createdByUserId: actorUserId(t.actor) })
        .onConflictDoNothing({ target: trialTemplates.key })
        .returning({ key: trialTemplates.key });
      if (rows.length > 0) created.push(template.key);
    }
    if (created.length > 0) {
      await recordAudit(t, {
        action: 'trial.templates_seeded',
        targetType: 'trial_template',
        context: { created },
      });
    }
    return {
      created,
      existing: templates.map((template) => template.key).filter((key) => !created.includes(key)),
    };
  });
}
