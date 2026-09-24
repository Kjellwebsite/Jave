import { and, eq, isNull } from 'drizzle-orm';
import { achievementDefinitions, memberAchievements, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import { type EventCountCriteria, parseStoredCriteria } from './criteria';

export type AchievementDefinitionRecord = typeof achievementDefinitions.$inferSelect;
export type MemberAchievementRecord = typeof memberAchievements.$inferSelect;

/** An active definition whose stored rule parsed as an event_count rule. */
export interface EventCountDefinition extends AchievementDefinitionRecord {
  criteria: EventCountCriteria;
}

/** Retroactive evaluation of one definition (job handler in engine.ts). */
export const ACHIEVEMENT_EVALUATE_JOB = 'achievements.evaluate_definition';

const EVENT_DEFINITIONS_CACHE_KEY = 'achievements:event-definitions';
/**
 * Rules change rarely; a short TTL bounds how long another process keeps a
 * stale rule set. Missed events are caught up by the evaluation job, which
 * counts history rather than single events.
 */
const EVENT_DEFINITIONS_TTL_MS = 30_000;

export async function loadDefinition(
  ctx: ServiceContext,
  key: string,
): Promise<AchievementDefinitionRecord> {
  const [row] = await ctx.db
    .select()
    .from(achievementDefinitions)
    .where(eq(achievementDefinitions.key, key));
  if (!row) throw new NotFoundError('Achievement');
  return row;
}

export function asEventCountDefinition(
  definition: AchievementDefinitionRecord,
): EventCountDefinition | null {
  const criteria = parseStoredCriteria(definition.criteria);
  if (!criteria || criteria.type !== 'event_count') return null;
  return { ...definition, criteria };
}

/** Active event_count definitions, cached per process. */
export async function activeEventCountDefinitions(
  ctx: ServiceContext,
): Promise<EventCountDefinition[]> {
  return ctx.cache.getOrLoad(EVENT_DEFINITIONS_CACHE_KEY, EVENT_DEFINITIONS_TTL_MS, async () => {
    const rows = await ctx.db
      .select()
      .from(achievementDefinitions)
      .where(eq(achievementDefinitions.active, true));
    return rows
      .map(asEventCountDefinition)
      .filter((row): row is EventCountDefinition => row !== null);
  });
}

export function invalidateDefinitionCache(ctx: ServiceContext): void {
  ctx.cache.delete(EVENT_DEFINITIONS_CACHE_KEY);
}

/** Queue a retroactive evaluation when an event_count rule becomes (or stays) active. */
export async function scheduleEvaluation(
  ctx: ServiceContext,
  definition: AchievementDefinitionRecord,
): Promise<boolean> {
  if (!definition.active || !asEventCountDefinition(definition)) return false;
  const id = await enqueueJob(
    ctx,
    ACHIEVEMENT_EVALUATE_JOB,
    { key: definition.key },
    { dedupeKey: `achievements:evaluate:${definition.key}` },
  );
  return id !== null;
}

/** The member's active (non-revoked) award for a definition, if any. */
export async function findActiveAward(
  ctx: ServiceContext,
  memberId: string,
  key: string,
): Promise<MemberAchievementRecord | null> {
  const [row] = await ctx.db
    .select()
    .from(memberAchievements)
    .where(
      and(
        eq(memberAchievements.memberId, memberId),
        eq(memberAchievements.achievementKey, key),
        isNull(memberAchievements.revokedAt),
      ),
    );
  return row ?? null;
}

/** Whether the member was ever awarded the definition (revoked awards included). */
export async function hasAwardHistory(
  ctx: ServiceContext,
  memberId: string,
  key: string,
): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: memberAchievements.id })
    .from(memberAchievements)
    .where(
      and(eq(memberAchievements.memberId, memberId), eq(memberAchievements.achievementKey, key)),
    )
    .limit(1);
  return rows.length > 0;
}

export interface AwardableMember {
  id: string;
  userId: string;
  standing: (typeof members.$inferSelect)['standing'];
  profileVisibility: (typeof members.$inferSelect)['profileVisibility'];
}

/**
 * Load a member that may receive awards: present in the database, not
 * soft-deleted and not banned. Returns null otherwise.
 */
export async function loadAwardableMember(
  ctx: ServiceContext,
  memberId: string,
): Promise<AwardableMember | null> {
  const [row] = await ctx.db
    .select({
      id: members.id,
      userId: members.userId,
      standing: members.standing,
      profileVisibility: members.profileVisibility,
    })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)));
  if (!row || row.standing === 'banned') return null;
  return row;
}
