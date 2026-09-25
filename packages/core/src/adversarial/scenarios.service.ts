import { and, asc, count, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, adversarialScenarios } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, isUniqueViolation, NotFoundError } from '../kernel/errors';
import type { Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { AUDIT_TARGET_SCENARIO } from './guards';
import { assertSafe, type SafetyField } from './safety';
import {
  createScenarioSchema,
  listScenariosSchema,
  scenarioIdSchema,
  updateScenarioSchema,
} from './schemas';
import { STARTER_SCENARIOS } from './starter-scenarios';

export type ScenarioRecord = typeof adversarialScenarios.$inferSelect;

const SCENARIO_ENTITY = 'Adversarial scenario';

interface ScenarioText {
  title: string;
  description: string;
  objective: string;
  guardrails: string;
  sandboxAssets: string;
}

/** Every scenario text field with the rule set it must pass. */
export function scenarioSafetyFields(scenario: ScenarioText): SafetyField[] {
  return [
    { field: 'title', text: scenario.title, kind: 'content' },
    { field: 'description', text: scenario.description, kind: 'content' },
    { field: 'objective', text: scenario.objective, kind: 'content' },
    { field: 'sandboxAssets', text: scenario.sandboxAssets, kind: 'content' },
    { field: 'guardrails', text: scenario.guardrails, kind: 'guardrails' },
  ];
}

export async function loadScenario(
  ctx: ServiceContext,
  scenarioId: string,
): Promise<ScenarioRecord> {
  const [row] = await ctx.db
    .select()
    .from(adversarialScenarios)
    .where(eq(adversarialScenarios.id, scenarioId));
  if (!row) throw new NotFoundError(SCENARIO_ENTITY);
  return row;
}

export async function createScenario(
  ctx: ServiceContext,
  input: z.input<typeof createScenarioSchema>,
): Promise<ScenarioRecord> {
  const data = parseInput(createScenarioSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_SCENARIO });
  assertSafe(scenarioSafetyFields(data));
  try {
    return await withTransaction(ctx, async (tx) => {
      const [row] = await tx.db
        .insert(adversarialScenarios)
        .values({ ...data, createdByUserId: actorUserId(tx.actor), createdAt: tx.clock.now() })
        .returning();
      const scenario = row!;
      await recordAudit(tx, {
        action: 'adversarial.scenario_created',
        targetType: AUDIT_TARGET_SCENARIO,
        targetId: scenario.id,
        context: { key: scenario.key, technique: scenario.technique },
      });
      return scenario;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'adversarial_scenarios_key_uq'))
      throw new ConflictError(`A scenario with key ${data.key} already exists.`);
    throw error;
  }
}

/**
 * Edit a scenario. The merged result is re-validated as a whole. Roles already
 * planned keep their own snapshot of objective, guardrails and assets.
 */
export async function updateScenario(
  ctx: ServiceContext,
  input: z.input<typeof updateScenarioSchema>,
): Promise<ScenarioRecord> {
  const data = parseInput(updateScenarioSchema, input);
  await authorize(ctx, 'canManageAdversarial', {
    type: AUDIT_TARGET_SCENARIO,
    id: data.scenarioId,
  });
  const current = await loadScenario(ctx, data.scenarioId);
  const { scenarioId, ...patch } = data;
  const changes = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => value !== undefined && value !== current[key as keyof ScenarioRecord],
    ),
  ) as Partial<typeof patch>;
  if (Object.keys(changes).length === 0) return current;
  const merged = { ...current, ...changes };
  assertSafe(scenarioSafetyFields(merged));
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(adversarialScenarios)
      .set({ ...changes, updatedAt: tx.clock.now() })
      .where(eq(adversarialScenarios.id, scenarioId))
      .returning();
    await recordAudit(tx, {
      action: 'adversarial.scenario_updated',
      targetType: AUDIT_TARGET_SCENARIO,
      targetId: scenarioId,
      context: { fields: Object.keys(changes), active: row!.active },
    });
    return row!;
  });
}

/** Hard delete, only for scenarios no role has used. Otherwise archive (active: false). */
export async function deleteScenario(
  ctx: ServiceContext,
  input: z.input<typeof scenarioIdSchema>,
): Promise<void> {
  const data = parseInput(scenarioIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', {
    type: AUDIT_TARGET_SCENARIO,
    id: data.scenarioId,
  });
  const scenario = await loadScenario(ctx, data.scenarioId);
  await withTransaction(ctx, async (tx) => {
    // Lock first: a role planned concurrently either commits before this count
    // (and blocks the delete) or waits and then fails as a conflict.
    await tx.db
      .select({ id: adversarialScenarios.id })
      .from(adversarialScenarios)
      .where(eq(adversarialScenarios.id, scenario.id))
      .for('update');
    const [usage] = await tx.db
      .select({ value: count() })
      .from(adversarialRoles)
      .where(eq(adversarialRoles.scenarioId, scenario.id));
    if ((usage?.value ?? 0) > 0)
      throw new ConflictError('This scenario was used by adversarial roles. Archive it instead.');
    await tx.db.delete(adversarialScenarios).where(eq(adversarialScenarios.id, scenario.id));
    await recordAudit(tx, {
      action: 'adversarial.scenario_deleted',
      targetType: AUDIT_TARGET_SCENARIO,
      targetId: scenario.id,
      context: { key: scenario.key },
    });
  });
}

export async function getScenario(
  ctx: ServiceContext,
  input: z.input<typeof scenarioIdSchema>,
): Promise<ScenarioRecord> {
  const data = parseInput(scenarioIdSchema, input);
  await authorize(ctx, 'canManageAdversarial', {
    type: AUDIT_TARGET_SCENARIO,
    id: data.scenarioId,
  });
  const scenario = await loadScenario(ctx, data.scenarioId);
  await recordAudit(ctx, {
    action: 'adversarial.scenario_viewed',
    targetType: AUDIT_TARGET_SCENARIO,
    targetId: scenario.id,
  });
  return scenario;
}

export async function listScenarios(
  ctx: ServiceContext,
  input: z.input<typeof listScenariosSchema> = {},
): Promise<Page<ScenarioRecord>> {
  const q = parseInput(listScenariosSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_SCENARIO });
  const filters: SQL[] = [];
  if (q.active !== undefined) filters.push(eq(adversarialScenarios.active, q.active));
  if (q.technique) filters.push(eq(adversarialScenarios.technique, q.technique));
  const where = filters.length ? and(...filters) : undefined;
  const [items, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(adversarialScenarios)
      .where(where)
      .orderBy(asc(adversarialScenarios.title), asc(adversarialScenarios.id))
      .limit(q.limit)
      .offset(q.offset),
    ctx.db.select({ value: count() }).from(adversarialScenarios).where(where),
  ]);
  await recordAudit(ctx, {
    action: 'adversarial.scenarios_listed',
    targetType: AUDIT_TARGET_SCENARIO,
    context: { active: q.active ?? null, technique: q.technique ?? null, returned: items.length },
  });
  return { items, total: total?.value ?? 0, limit: q.limit, offset: q.offset };
}

/**
 * Insert the starter library. Idempotent: existing keys (including ones staff
 * edited) are left untouched. Every starter scenario is validated first.
 */
export async function seedStarterScenarios(
  ctx: ServiceContext,
): Promise<{ created: string[]; existing: string[] }> {
  await authorize(ctx, 'canManageAdversarial', { type: AUDIT_TARGET_SCENARIO });
  for (const scenario of STARTER_SCENARIOS) assertSafe(scenarioSafetyFields(scenario));
  return withTransaction(ctx, async (tx) => {
    const created: string[] = [];
    const existing: string[] = [];
    for (const scenario of STARTER_SCENARIOS) {
      const [row] = await tx.db
        .insert(adversarialScenarios)
        .values({ ...scenario, createdByUserId: actorUserId(tx.actor), createdAt: tx.clock.now() })
        .onConflictDoNothing({ target: adversarialScenarios.key })
        .returning({ key: adversarialScenarios.key });
      (row ? created : existing).push(scenario.key);
    }
    if (created.length > 0) {
      await recordAudit(tx, {
        action: 'adversarial.scenarios_seeded',
        targetType: AUDIT_TARGET_SCENARIO,
        context: { created },
      });
    }
    return { created, existing };
  });
}
