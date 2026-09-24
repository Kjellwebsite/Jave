import { asc, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { achievementDefinitions, memberAchievements, missions } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { authorize } from '../permissions/authorize';
import { isValidFacet, loadCatalog } from '../identity/ranks';
import {
  createDefinitionSchema,
  definitionKeyInputSchema,
  updateDefinitionSchema,
} from './schemas';
import { STARTER_ACHIEVEMENTS } from './starter';
import { type AchievementDefinitionRecord, loadDefinition, scheduleEvaluation } from './store';

async function assertFacet(ctx: ServiceContext, facetKey: string | null | undefined) {
  if (!facetKey) return;
  const catalog = await loadCatalog(ctx);
  if (!isValidFacet(catalog, facetKey)) throw new ValidationError('Unknown capability.');
}

/** Field-level diff for the audit log (criteria compared structurally). */
function changedFields(
  before: AchievementDefinitionRecord,
  patch: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(patch)) {
    const from = before[field as keyof AchievementDefinitionRecord];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

/** Define a new achievement. New active event_count rules are evaluated retroactively. */
export async function createAchievementDefinition(
  ctx: ServiceContext,
  input: z.input<typeof createDefinitionSchema>,
): Promise<AchievementDefinitionRecord> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const data = parseInput(createDefinitionSchema, input);
  await assertFacet(ctx, data.facetKey);
  const now = ctx.clock.now();
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(achievementDefinitions)
      .values({ ...data, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: achievementDefinitions.key })
      .returning();
    if (!row) throw new ConflictError('An achievement with that key already exists.');
    await recordAudit(tx, {
      action: 'achievement.definition_created',
      targetType: 'achievement',
      targetId: row.key,
      context: { criteria: row.criteria, rarity: row.rarity, visibility: row.visibility },
    });
    await scheduleEvaluation(tx, row);
    return row;
  });
}

/**
 * Edit a definition. Existing awards are never touched: raising a threshold
 * does not revoke anyone. A changed or re-activated event_count rule is
 * re-evaluated against history.
 */
export async function updateAchievementDefinition(
  ctx: ServiceContext,
  input: z.input<typeof updateDefinitionSchema>,
): Promise<AchievementDefinitionRecord> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const { key, patch } = parseInput(updateDefinitionSchema, input);
  await assertFacet(ctx, patch.facetKey);
  const before = await loadDefinition(ctx, key);
  const changes = changedFields(before, patch);
  if (Object.keys(changes).length === 0) return before;
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(achievementDefinitions)
      .set({ ...patch, updatedAt: tx.clock.now() })
      .where(eq(achievementDefinitions.key, key))
      .returning();
    await recordAudit(tx, {
      action: 'achievement.definition_updated',
      targetType: 'achievement',
      targetId: key,
      context: { changes },
    });
    if ('criteria' in changes || 'active' in changes) await scheduleEvaluation(tx, row!);
    return row!;
  });
}

/**
 * Delete a definition nobody has ever held and no mission rewards. Anything
 * with history is deactivated instead (update `active: false`), so awards and
 * their audit trail stay intact.
 */
export async function deleteAchievementDefinition(
  ctx: ServiceContext,
  input: z.input<typeof definitionKeyInputSchema>,
): Promise<void> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const { key } = parseInput(definitionKeyInputSchema, input);
  const definition = await loadDefinition(ctx, key);
  await withTransaction(ctx, async (tx) => {
    const [[awards], [rewards]] = await Promise.all([
      tx.db
        .select({ value: count() })
        .from(memberAchievements)
        .where(eq(memberAchievements.achievementKey, key)),
      tx.db.select({ value: count() }).from(missions).where(eq(missions.rewardAchievementKey, key)),
    ]);
    if ((awards?.value ?? 0) > 0 || (rewards?.value ?? 0) > 0) {
      throw new ConflictError('This achievement has history. Deactivate it instead.');
    }
    await tx.db.delete(achievementDefinitions).where(eq(achievementDefinitions.key, key));
    await recordAudit(tx, {
      action: 'achievement.definition_deleted',
      targetType: 'achievement',
      targetId: key,
      context: { title: definition.title },
    });
  });
}

/** Raw definition for editing (staff). */
export async function getAchievementDefinition(
  ctx: ServiceContext,
  input: z.input<typeof definitionKeyInputSchema>,
): Promise<AchievementDefinitionRecord> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const { key } = parseInput(definitionKeyInputSchema, input);
  return loadDefinition(ctx, key);
}

/** Every definition, active or not, in display order (staff). */
export async function listAchievementDefinitions(
  ctx: ServiceContext,
): Promise<AchievementDefinitionRecord[]> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  return ctx.db
    .select()
    .from(achievementDefinitions)
    .orderBy(asc(achievementDefinitions.ordinal), asc(achievementDefinitions.key));
}

export interface SeedResult {
  created: string[];
  existing: string[];
}

/**
 * Install the starter catalog. Idempotent: existing keys are left exactly as
 * staff last edited them. New event_count rules are evaluated retroactively.
 */
export async function seedStarterAchievements(ctx: ServiceContext): Promise<SeedResult> {
  await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const definitions = STARTER_ACHIEVEMENTS.map((starter) =>
    parseInput(createDefinitionSchema, starter),
  );
  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const created: string[] = [];
    const existing: string[] = [];
    for (const definition of definitions) {
      const [row] = await tx.db
        .insert(achievementDefinitions)
        .values({ ...definition, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: achievementDefinitions.key })
        .returning();
      if (!row) {
        existing.push(definition.key);
        continue;
      }
      created.push(row.key);
      await scheduleEvaluation(tx, row);
    }
    if (created.length > 0) {
      await recordAudit(tx, {
        action: 'achievement.starter_seeded',
        targetType: 'achievement',
        context: { created },
      });
    }
    return { created, existing };
  });
}
