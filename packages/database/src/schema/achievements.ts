import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_shared';
import { capabilityFacets, members, users } from './identity';

export const achievementRarity = pgEnum('achievement_rarity', [
  'standard',
  'notable',
  'rare',
  'exceptional',
  'singular',
]);
export const achievementVisibility = pgEnum('achievement_visibility', ['public', 'hidden']);

/**
 * Achievement rule DSL (validated with zod in @jave/core):
 *  - { type: 'event_count', event: 'project.shipped', threshold: 3 }
 *  - { type: 'manual' }  — awarded by staff only
 */
export type AchievementCriteria =
  { type: 'event_count'; event: string; threshold: number } | { type: 'manual' };

export const achievementDefinitions = pgTable('achievement_definitions', {
  key: varchar('key', { length: 64 }).primaryKey(),
  title: varchar('title', { length: 64 }).notNull(),
  description: text('description').notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  rarity: achievementRarity('rarity').notNull().default('standard'),
  visibility: achievementVisibility('visibility').notNull().default('public'),
  criteria: jsonb('criteria').$type<AchievementCriteria>().notNull(),
  requiresVerification: boolean('requires_verification').notNull().default(false),
  facetKey: varchar('facet_key', { length: 48 }).references(() => capabilityFacets.key),
  active: boolean('active').notNull().default(true),
  ordinal: smallint('ordinal').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const achievementVerification = pgEnum('achievement_verification', [
  'unverified',
  'verified',
]);

export const memberAchievements = pgTable(
  'member_achievements',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    achievementKey: varchar('achievement_key', { length: 64 })
      .notNull()
      .references(() => achievementDefinitions.key),
    awardedAt: ts('awarded_at').notNull().defaultNow(),
    /** Null when awarded automatically by the rule engine. */
    awardedByUserId: uuid('awarded_by_user_id').references(() => users.id),
    sourceEventId: bigint('source_event_id', { mode: 'number' }),
    verification: achievementVerification('verification').notNull().default('unverified'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: ts('verified_at'),
    note: text('note'),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    uniqueIndex('member_achievements_active_uq')
      .on(t.memberId, t.achievementKey)
      .where(sql`${t.revokedAt} is null`),
    index('member_achievements_key_idx').on(t.achievementKey),
  ],
);
