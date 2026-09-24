import { sql } from 'drizzle-orm';
import { memberAchievements } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { publishEvent } from '../events/bus';
import { notify } from '../notifications/notifications.service';
import { actorUserId } from '../permissions/actor';
import { achievementHeadline } from './criteria';
import { scheduleAchievementAnnouncement } from './discord-jobs';
import type {
  AchievementDefinitionRecord,
  AwardableMember,
  MemberAchievementRecord,
} from './store';

/** How an award came to be. Recorded on the achievement.unlocked event. */
export type AwardSource = 'engine' | 'backfill' | 'manual' | 'system';

export interface GrantInput {
  member: AwardableMember;
  definition: AchievementDefinitionRecord;
  source: AwardSource;
  sourceEventId?: number | null;
  note?: string | null;
  /** Queue the public Discord card (still subject to settings, visibility and privacy). */
  announce: boolean;
}

/**
 * Insert an award with its event, notification and announcement. Must run
 * inside the caller's transaction. Returns null when the member already
 * holds an active award for this definition (enforced by the partial unique
 * index, so concurrent grants cannot double-award).
 *
 * Definitions that require verification are awarded UNVERIFIED and are not
 * announced until a second person verifies them.
 */
export async function grantAchievement(
  tx: ServiceContext,
  input: GrantInput,
): Promise<MemberAchievementRecord | null> {
  const { member, definition } = input;
  const now = tx.clock.now();
  const awarder = actorUserId(tx.actor);
  const verified = !definition.requiresVerification;
  const [award] = await tx.db
    .insert(memberAchievements)
    .values({
      memberId: member.id,
      achievementKey: definition.key,
      awardedAt: now,
      awardedByUserId: awarder,
      sourceEventId: input.sourceEventId ?? null,
      verification: verified ? 'verified' : 'unverified',
      verifiedAt: verified ? now : null,
      verifiedByUserId: verified ? awarder : null,
      note: input.note ?? null,
    })
    .onConflictDoNothing({
      target: [memberAchievements.memberId, memberAchievements.achievementKey],
      where: sql`${memberAchievements.revokedAt} is null`,
    })
    .returning();
  if (!award) return null;

  await publishEvent(tx, {
    type: 'achievement.unlocked',
    aggregateType: 'member_achievement',
    aggregateId: award.id,
    subjectMemberId: member.id,
    payload: {
      key: definition.key,
      title: definition.title,
      rarity: definition.rarity,
      visibility: definition.visibility,
      source: input.source,
      verified,
    },
  });
  const headline = achievementHeadline(definition);
  await notify(tx, {
    recipientUserId: member.userId,
    type: 'achievement.unlocked',
    title: 'ACHIEVEMENT UNLOCKED',
    body: verified ? headline : `${headline} Pending verification.`,
    data: { key: definition.key, memberAchievementId: award.id },
    dedupeKey: `achievement:${award.id}:unlocked`,
  });
  if (input.announce) await scheduleAchievementAnnouncement(tx, award, definition, member);
  return award;
}
