import { and, eq, isNull, sql } from 'drizzle-orm';
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

/**
 * Active event_count rules that count `eventType`.
 *
 * Read from the database for every delivered event and never from the
 * per-process cache: rules are edited in the dashboard process but applied
 * in the bot's worker, where a cached rule set would miss events (or keep
 * awarding under a retired rule) until it expired. It is one small query
 * per delivered event.
 */
export async function activeRulesForEvent(
  ctx: ServiceContext,
  eventType: string,
): Promise<EventCountDefinition[]> {
  const rows = await ctx.db
    .select()
    .from(achievementDefinitions)
    .where(
      and(
        eq(achievementDefinitions.active, true),
        sql`${achievementDefinitions.criteria}->>'type' = 'event_count'`,
        sql`${achievementDefinitions.criteria}->>'event' = ${eventType}`,
      ),
    );
  return rows
    .map(asEventCountDefinition)
    .filter((row): row is EventCountDefinition => row !== null && row.criteria.event === eventType);
}

/**
 * Re-read a rule inside the award transaction under a share lock. The lock
 * waits for a concurrent edit to commit and then sees the edited rule, and
 * it holds off further edits until the award commits, so an award is only
 * ever made under the rule as it currently stands. Returns null when the
 * rule is gone, inactive, or no longer an event_count rule.
 */
export async function lockCurrentRule(
  tx: ServiceContext,
  key: string,
): Promise<EventCountDefinition | null> {
  const [row] = await tx.db
    .select()
    .from(achievementDefinitions)
    .where(eq(achievementDefinitions.key, key))
    .for('share');
  if (!row?.active) return null;
  return asEventCountDefinition(row);
}

/** Whether two versions of a rule award for the same thing (same event, same threshold). */
export function sameRule(a: EventCountDefinition, b: EventCountDefinition): boolean {
  return a.criteria.event === b.criteria.event && a.criteria.threshold === b.criteria.threshold;
}

/**
 * Queue a retroactive evaluation when an event_count rule becomes (or stays)
 * active. The dedupe key carries the rule version: an edit made while an
 * evaluation of the previous version is running still gets its own run
 * (the running one stops as soon as it sees the rule changed).
 */
export async function scheduleEvaluation(
  ctx: ServiceContext,
  definition: AchievementDefinitionRecord,
): Promise<boolean> {
  if (!definition.active || !asEventCountDefinition(definition)) return false;
  const id = await enqueueJob(
    ctx,
    ACHIEVEMENT_EVALUATE_JOB,
    { key: definition.key },
    { dedupeKey: `achievements:evaluate:${definition.key}:${definition.updatedAt.getTime()}` },
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
