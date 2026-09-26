import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { achievementDefinitions, memberAchievements, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { type Page, pageSchema } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { actorMemberId, actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import type { AchievementRarity } from './criteria';

export const pendingAwardsQuerySchema = pageSchema.strict();

/** An UNVERIFIED award waiting for a second person. */
export interface PendingAwardItem {
  awardId: string;
  memberId: string;
  memberHandle: string;
  memberDisplayName: string;
  key: string;
  title: string;
  rarity: AchievementRarity;
  awardedAt: Date;
  /** Null for awards made by a system process (rules, mission rewards). */
  awardedByName: string | null;
  note: string | null;
  /** The viewer holds this award: they may not verify it. */
  isOwn: boolean;
  /** The viewer made this award: someone else must verify it. */
  awardedByViewer: boolean;
}

const awarder = alias(members, 'awarder');

/**
 * Awards that still need verification (canAwardAchievements), oldest first.
 * Revoked awards and awards of deleted members are left out. The flags tell
 * the viewer which entries they cannot verify themselves; verifying enforces
 * the same rules.
 */
export async function listPendingAchievementAwards(
  ctx: ServiceContext,
  input: z.input<typeof pendingAwardsQuerySchema> = {},
): Promise<Page<PendingAwardItem>> {
  const query = parseInput(pendingAwardsQuerySchema, input);
  await authorize(ctx, 'canAwardAchievements', { type: 'achievement' });
  const where = and(
    eq(memberAchievements.verification, 'unverified'),
    isNull(memberAchievements.revokedAt),
    isNull(members.deletedAt),
  );
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select({
        award: memberAchievements,
        definition: {
          title: achievementDefinitions.title,
          rarity: achievementDefinitions.rarity,
        },
        member: { handle: members.handle, displayName: members.displayName },
        awarderName: awarder.displayName,
      })
      .from(memberAchievements)
      .innerJoin(members, eq(members.id, memberAchievements.memberId))
      .innerJoin(
        achievementDefinitions,
        eq(achievementDefinitions.key, memberAchievements.achievementKey),
      )
      .leftJoin(awarder, eq(awarder.userId, memberAchievements.awardedByUserId))
      .where(where)
      .orderBy(asc(memberAchievements.awardedAt), asc(memberAchievements.id))
      .limit(query.limit)
      .offset(query.offset),
    ctx.db
      .select({ value: count() })
      .from(memberAchievements)
      .innerJoin(members, eq(members.id, memberAchievements.memberId))
      .where(where),
  ]);
  const viewerMember = actorMemberId(ctx.actor);
  const viewerUser = actorUserId(ctx.actor);
  return {
    items: rows.map(({ award, definition, member, awarderName }) => ({
      awardId: award.id,
      memberId: award.memberId,
      memberHandle: member.handle,
      memberDisplayName: member.displayName,
      key: award.achievementKey,
      title: definition.title,
      rarity: definition.rarity,
      awardedAt: award.awardedAt,
      awardedByName: award.awardedByUserId ? (awarderName ?? null) : null,
      note: award.note,
      isOwn: viewerMember !== null && award.memberId === viewerMember,
      awardedByViewer: viewerUser !== null && award.awardedByUserId === viewerUser,
    })),
    total: total?.value ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}
