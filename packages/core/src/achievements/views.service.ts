import { and, asc, count, desc, eq, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { achievementDefinitions, memberAchievements, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { actorMemberId } from '../permissions/actor';
import { authorize, can } from '../permissions/authorize';
import { getProfile } from '../identity/profile.service';
import {
  type AchievementRarity,
  type AchievementVisibility,
  holderPercent,
  type ParsedAchievementCriteria,
  parseStoredCriteria,
  unlockSummary,
} from './criteria';
import { catalogQuerySchema, memberAchievementsQuerySchema } from './schemas';
import type { AchievementDefinitionRecord } from './store';

export const HIDDEN_TITLE = 'HIDDEN';
export const HIDDEN_SUMMARY = 'Classified.';
export const HIDDEN_DESCRIPTION = 'Unlock it to reveal it.';
/** Upper bound on awards returned for one member. */
export const MEMBER_ACHIEVEMENTS_LIMIT = 200;

/** Staff see hidden definitions unmasked. */
function viewerIsAchievementStaff(ctx: ServiceContext): boolean {
  return can(ctx, 'canManageAchievements') || can(ctx, 'canAwardAchievements');
}

export interface RevealedCatalogEntry {
  masked: false;
  key: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  rarity: AchievementRarity;
  visibility: AchievementVisibility;
  criteria: ParsedAchievementCriteria | null;
  requiresVerification: boolean;
  facetKey: string | null;
  active: boolean;
  unlocked: boolean;
  unlockedAt: Date | null;
  verified: boolean | null;
}

export interface MaskedCatalogEntry {
  masked: true;
  /** Position in the catalog, so lists can render stable placeholders. */
  slot: number;
  title: typeof HIDDEN_TITLE;
  summary: typeof HIDDEN_SUMMARY;
  description: typeof HIDDEN_DESCRIPTION;
  rarity: AchievementRarity;
  unlocked: false;
}

export type CatalogEntry = RevealedCatalogEntry | MaskedCatalogEntry;

function mask(slot: number, definition: AchievementDefinitionRecord): MaskedCatalogEntry {
  return {
    masked: true,
    slot,
    title: HIDDEN_TITLE,
    summary: HIDDEN_SUMMARY,
    description: HIDDEN_DESCRIPTION,
    rarity: definition.rarity,
    unlocked: false,
  };
}

async function viewerAwards(ctx: ServiceContext) {
  const memberId = actorMemberId(ctx.actor);
  if (!memberId) return new Map<string, { awardedAt: Date; verified: boolean }>();
  const rows = await ctx.db
    .select({
      key: memberAchievements.achievementKey,
      awardedAt: memberAchievements.awardedAt,
      verification: memberAchievements.verification,
    })
    .from(memberAchievements)
    .where(and(eq(memberAchievements.memberId, memberId), isNull(memberAchievements.revokedAt)));
  return new Map(
    rows.map((row) => [
      row.key,
      { awardedAt: row.awardedAt, verified: row.verification === 'verified' },
    ]),
  );
}

/**
 * The achievement catalog as the viewer may see it. Hidden definitions are
 * masked unless the viewer unlocked them; achievement staff see everything
 * and may include inactive definitions. Anonymous viewers get the public
 * catalog.
 */
export async function getAchievementCatalog(
  ctx: ServiceContext,
  input: z.input<typeof catalogQuerySchema> = {},
): Promise<CatalogEntry[]> {
  const query = parseInput(catalogQuerySchema, input);
  if (query.includeInactive) await authorize(ctx, 'canManageAchievements', { type: 'achievement' });
  const staff = viewerIsAchievementStaff(ctx);
  const [definitions, unlocked] = await Promise.all([
    ctx.db
      .select()
      .from(achievementDefinitions)
      .where(query.includeInactive ? undefined : eq(achievementDefinitions.active, true))
      .orderBy(asc(achievementDefinitions.ordinal), asc(achievementDefinitions.key)),
    viewerAwards(ctx),
  ]);
  return definitions.map((definition, slot): CatalogEntry => {
    const award = unlocked.get(definition.key);
    if (definition.visibility === 'hidden' && !staff && !award) return mask(slot, definition);
    return {
      masked: false,
      key: definition.key,
      title: definition.title,
      summary: unlockSummary(definition),
      description: definition.description,
      category: definition.category,
      rarity: definition.rarity,
      visibility: definition.visibility,
      criteria: parseStoredCriteria(definition.criteria),
      requiresVerification: definition.requiresVerification,
      facetKey: definition.facetKey,
      active: definition.active,
      unlocked: Boolean(award),
      unlockedAt: award?.awardedAt ?? null,
      verified: award ? award.verified : null,
    };
  });
}

export interface MemberAchievementView {
  id: string;
  key: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  rarity: AchievementRarity;
  visibility: AchievementVisibility;
  awardedAt: Date;
  verified: boolean;
  /** 'staff' for manual awards, 'rule' for engine, backfill and system grants. */
  origin: 'staff' | 'rule';
  /** Present only when staff asked for revoked history. */
  revokedAt: Date | null;
  revokeReason: string | null;
}

/**
 * A member's achievements. Visibility follows the identity profile rules
 * (getProfile): an invisible profile is reported as not found. Unlocked
 * hidden achievements are shown on the holder's profile, as in getProfile.
 * Revoked history is staff-only (canAwardAchievements).
 */
export async function listMemberAchievements(
  ctx: ServiceContext,
  input: z.input<typeof memberAchievementsQuerySchema>,
): Promise<MemberAchievementView[]> {
  const query = parseInput(memberAchievementsQuerySchema, input);
  await getProfile(ctx, { memberId: query.memberId });
  if (query.includeRevoked)
    await authorize(ctx, 'canAwardAchievements', { type: 'member', id: query.memberId });
  const rows = await ctx.db
    .select({ award: memberAchievements, definition: achievementDefinitions })
    .from(memberAchievements)
    .innerJoin(
      achievementDefinitions,
      eq(achievementDefinitions.key, memberAchievements.achievementKey),
    )
    .where(
      and(
        eq(memberAchievements.memberId, query.memberId),
        query.includeRevoked ? undefined : isNull(memberAchievements.revokedAt),
      ),
    )
    .orderBy(desc(memberAchievements.awardedAt))
    .limit(MEMBER_ACHIEVEMENTS_LIMIT);
  return rows.map(({ award, definition }) => ({
    id: award.id,
    key: definition.key,
    title: definition.title,
    summary: unlockSummary(definition),
    description: definition.description,
    category: definition.category,
    rarity: definition.rarity,
    visibility: definition.visibility,
    awardedAt: award.awardedAt,
    verified: award.verification === 'verified',
    origin: award.awardedByUserId ? 'staff' : 'rule',
    revokedAt: query.includeRevoked ? award.revokedAt : null,
    revokeReason: query.includeRevoked ? award.revokeReason : null,
  }));
}

export type RarityStat =
  | {
      masked: false;
      key: string;
      title: string;
      rarity: AchievementRarity;
      holders: number;
      percent: number;
    }
  | { masked: true; slot: number; rarity: AchievementRarity; holders: number; percent: number };

export interface RarityStats {
  /** Present in the guild, not deleted, not banned. */
  activeMembers: number;
  achievements: RarityStat[];
}

const activeMemberFilter = and(
  isNull(members.deletedAt),
  ne(members.standing, 'banned'),
  eq(members.guildStatus, 'present'),
);

/** Share of active members holding each active achievement (hidden ones masked for non-staff). */
export async function getAchievementRarityStats(ctx: ServiceContext): Promise<RarityStats> {
  await authorize(ctx, 'canViewMembers', { type: 'achievement' });
  const staff = viewerIsAchievementStaff(ctx);
  const [definitions, [population], holderRows, unlocked] = await Promise.all([
    ctx.db
      .select()
      .from(achievementDefinitions)
      .where(eq(achievementDefinitions.active, true))
      .orderBy(asc(achievementDefinitions.ordinal), asc(achievementDefinitions.key)),
    ctx.db.select({ value: count() }).from(members).where(activeMemberFilter),
    ctx.db
      .select({ key: memberAchievements.achievementKey, holders: count() })
      .from(memberAchievements)
      .innerJoin(members, eq(members.id, memberAchievements.memberId))
      .where(and(isNull(memberAchievements.revokedAt), activeMemberFilter))
      .groupBy(memberAchievements.achievementKey),
    viewerAwards(ctx),
  ]);
  const activeMembers = population?.value ?? 0;
  const holdersByKey = new Map(holderRows.map((row) => [row.key, row.holders]));
  return {
    activeMembers,
    achievements: definitions.map((definition, slot): RarityStat => {
      const holders = holdersByKey.get(definition.key) ?? 0;
      const percent = holderPercent(holders, activeMembers);
      if (definition.visibility === 'hidden' && !staff && !unlocked.has(definition.key)) {
        return { masked: true, slot, rarity: definition.rarity, holders, percent };
      }
      return {
        masked: false,
        key: definition.key,
        title: definition.title,
        rarity: definition.rarity,
        holders,
        percent,
      };
    }),
  };
}
