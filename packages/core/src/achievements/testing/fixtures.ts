import { eq } from 'drizzle-orm';
import { jobs, memberAchievements } from '@jave/database';
import type { TestKit } from '../../testing';
import { createEventHandlers, publishEvent } from '../../events/bus';
import type { DomainEventType } from '../../events/catalog';
import { updateSettings } from '../../settings/settings.service';
import { jobHandlers, subscribers } from '../index';

/** Achievement job handlers with the rule engine subscribed. */
export const achievementTestHandlers = { ...jobHandlers, ...createEventHandlers(subscribers) };

export const ACHIEVEMENTS_CHANNEL = '123456789012345678';

/** Publish `times` events of `type` about `memberId` (null = no subject). */
export async function emitEvents(
  kit: TestKit,
  type: DomainEventType,
  memberId: string | null,
  times = 1,
) {
  for (let i = 0; i < times; i++) {
    await publishEvent(kit.system, {
      type,
      aggregateType: 'test',
      aggregateId: `agg-${i}`,
      subjectMemberId: memberId,
    });
  }
}

export async function awardsOf(kit: TestKit, memberId: string) {
  return kit.db.select().from(memberAchievements).where(eq(memberAchievements.memberId, memberId));
}

/** Keys of the member's non-revoked awards, sorted. */
export async function activeKeys(kit: TestKit, memberId: string) {
  return (await awardsOf(kit, memberId))
    .filter((row) => row.revokedAt === null)
    .map((row) => row.achievementKey)
    .sort();
}

export async function jobsOfType(kit: TestKit, type: string) {
  return kit.db.select().from(jobs).where(eq(jobs.type, type));
}

export async function enableAnnouncements(kit: TestKit) {
  await updateSettings(kit.system, 'channels', { achievements: ACHIEVEMENTS_CHANNEL });
  await updateSettings(kit.system, 'notifications', { announceAchievements: true });
}
