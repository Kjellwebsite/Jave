import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  achievementDefinitions,
  auditLogs,
  domainEvents,
  members,
  notifications,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { DomainEventType } from '../events/catalog';
import type { UserActor } from '../permissions/actor';
import { updateProfile } from '../identity/profile.service';
import { updateSettings } from '../settings/settings.service';
import {
  awardAchievement,
  awardAchievementFromSystem,
  createAchievementDefinition,
  DISCORD_ACHIEVEMENT_ANNOUNCE_JOB,
  DISCORD_ACHIEVEMENT_RETRACT_JOB,
  evaluateEventForAchievements,
  getAchievementAnnouncement,
  markAchievementAnnounced,
  revokeAchievement,
  seedStarterAchievements,
  STARTER_ACHIEVEMENTS,
  updateAchievementDefinition,
} from './index';
import {
  ACHIEVEMENTS_CHANNEL,
  achievementTestHandlers,
  activeKeys,
  awardsOf,
  emitEvents,
  enableAnnouncements,
  jobsOfType,
} from './testing/fixtures';

describe('achievements — engine and announcements', () => {
  let kit: TestKit;
  let core: UserActor;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
    ops = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  const emit = (type: DomainEventType, memberId: string | null, times = 1) =>
    emitEvents(kit, type, memberId, times);
  const awards = (memberId: string) => awardsOf(kit, memberId);
  const keysOf = (memberId: string) => activeKeys(kit, memberId);
  const jobsOf = (type: string) => jobsOfType(kit, type);
  const announceOn = () => enableAnnouncements(kit);

  describe('starter catalog', () => {
    it('seeds idempotently and preserves staff edits', async () => {
      const first = await seedStarterAchievements(kit.as(core));
      expect(first.created).toHaveLength(STARTER_ACHIEVEMENTS.length);
      await updateAchievementDefinition(kit.as(core), {
        key: 'builder',
        patch: { summary: 'Three shipped.' },
      });
      const second = await seedStarterAchievements(kit.as(core));
      expect(second.created).toEqual([]);
      expect(second.existing).toHaveLength(STARTER_ACHIEVEMENTS.length);
      const [builder] = await kit.db
        .select()
        .from(achievementDefinitions)
        .where(eq(achievementDefinitions.key, 'builder'));
      expect(builder?.summary).toBe('Three shipped.');
      const audits = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'achievement.starter_seeded'));
      expect(audits).toHaveLength(1);
    });
  });

  describe('rule engine', () => {
    beforeEach(async () => {
      await seedStarterAchievements(kit.system);
      await kit.drain(achievementTestHandlers);
    });

    it('awards exactly when thresholds are met', async () => {
      const m = await kit.member();
      await emit('project.shipped', m.memberId, 2);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual(['project_shipped']);

      await emit('project.shipped', m.memberId, 1);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual(['builder', 'project_shipped']);

      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, m.userId),
            eq(notifications.type, 'achievement.unlocked'),
          ),
        );
      expect(inbox.map((n) => n.body).sort()).toEqual([
        'BUILDER — 3 projects shipped.',
        'PROJECT SHIPPED — First project shipped.',
      ]);
      expect(inbox.every((n) => n.title === 'ACHIEVEMENT UNLOCKED')).toBe(true);
      const unlocked = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'achievement.unlocked'));
      expect(unlocked).toHaveLength(2);
      expect(unlocked.every((e) => e.subjectMemberId === m.memberId)).toBe(true);
    });

    it('counts only the subject member’s own events', async () => {
      const a = await kit.member();
      const b = await kit.member();
      await emit('project.shipped', a.memberId, 2);
      await emit('project.shipped', b.memberId, 1);
      await emit('project.shipped', null, 5);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(a.memberId!)).toEqual(['project_shipped']);
      expect(await keysOf(b.memberId!)).toEqual(['project_shipped']);
    });

    it('is idempotent under duplicate and concurrent delivery of the same event', async () => {
      const m = await kit.member();
      await emit('mission.completed', m.memberId);
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'mission.completed'));
      const results = await Promise.all([
        evaluateEventForAchievements(kit.system, event!),
        evaluateEventForAchievements(kit.system, event!),
      ]);
      await evaluateEventForAchievements(kit.system, event!);
      await kit.drain(achievementTestHandlers);
      const awarded = results.flatMap((r) => r.awarded);
      expect(awarded).toEqual(['first_mission']);
      const rows = await awards(m.memberId!);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.sourceEventId).toBe(event!.id);
      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, m.userId));
      expect(inbox.filter((n) => n.type === 'achievement.unlocked')).toHaveLength(1);
    });

    it('never re-awards a revoked achievement automatically; staff can restore it', async () => {
      const m = await kit.member();
      await emit('project.shipped', m.memberId);
      await kit.drain(achievementTestHandlers);
      await revokeAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'project_shipped',
        reason: 'Shipped project was not the member’s work.',
      });
      await emit('project.shipped', m.memberId);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual([]);
      const outcome = await awardAchievementFromSystem(kit.system, {
        memberId: m.memberId!,
        key: 'project_shipped',
        reason: 'retry',
      });
      expect(outcome).toEqual({ status: 'skipped', reason: 'previously_revoked' });

      await awardAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'project_shipped',
        reason: 'Evidence re-reviewed.',
      });
      expect(await keysOf(m.memberId!)).toEqual(['project_shipped']);
      expect(await awards(m.memberId!)).toHaveLength(2);
    });

    it('ignores banned and deleted members', async () => {
      const banned = await kit.member();
      const deleted = await kit.member();
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, banned.memberId!));
      await kit.db
        .update(members)
        .set({ deletedAt: kit.clock.now() })
        .where(eq(members.id, deleted.memberId!));
      await emit('mission.completed', banned.memberId);
      await emit('mission.completed', deleted.memberId);
      await emit('mission.completed', '00000000-0000-4000-8000-000000000000');
      const outcomes = await kit.drain(achievementTestHandlers);
      expect(outcomes.filter((o) => o.status !== 'completed')).toEqual([]);
      expect(await awards(banned.memberId!)).toEqual([]);
      expect(await awards(deleted.memberId!)).toEqual([]);
    });

    it('ignores inactive rules and picks up rule changes', async () => {
      const m = await kit.member();
      await updateAchievementDefinition(kit.as(core), {
        key: 'first_mission',
        patch: { active: false },
      });
      await emit('mission.completed', m.memberId);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual([]);
      await updateAchievementDefinition(kit.as(core), {
        key: 'first_mission',
        patch: { active: true },
      });
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual(['first_mission']);
    });
  });

  describe('retroactive evaluation', () => {
    it('awards members whose history already meets a new rule, without public announcements', async () => {
      await announceOn();
      const veteran = await kit.member();
      const newcomer = await kit.member();
      await emit('research.verified', veteran.memberId, 3);
      await emit('research.verified', newcomer.memberId, 1);
      await kit.drain(achievementTestHandlers);
      await createAchievementDefinition(kit.as(core), {
        key: 'scholar',
        title: 'Scholar',
        summary: '3 research items verified.',
        description: 'Three verified research items.',
        category: 'research',
        criteria: { type: 'event_count', event: 'research.verified', threshold: 3 },
      });
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(veteran.memberId!)).toEqual(['scholar']);
      expect(await keysOf(newcomer.memberId!)).toEqual([]);
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toEqual([]);
      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, veteran.userId));
      expect(inbox.map((n) => n.body)).toContain('SCHOLAR — 3 research items verified.');
    });
  });

  describe('announcements', () => {
    beforeEach(async () => {
      await seedStarterAchievements(kit.system);
      await kit.drain(achievementTestHandlers);
    });

    it('queues a Discord card for public awards and lets the bot report it once', async () => {
      await announceOn();
      const m = await kit.member();
      await emit('project.created', m.memberId);
      await kit.drain(achievementTestHandlers);
      const [job] = await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB);
      expect(job?.payload).toMatchObject({ channelId: ACHIEVEMENTS_CHANNEL });
      const memberAchievementId = String(job?.payload.memberAchievementId);

      const card = await getAchievementAnnouncement(kit.system, { memberAchievementId });
      expect(card?.line).toBe('ACHIEVEMENT UNLOCKED — FIRST PROJECT — First project on record.');
      expect(card?.memberDiscordId).toBe(m.discordId);

      const first = await markAchievementAnnounced(kit.system, {
        memberAchievementId,
        channelId: ACHIEVEMENTS_CHANNEL,
        messageId: '223456789012345678',
      });
      const second = await markAchievementAnnounced(kit.system, {
        memberAchievementId,
        channelId: ACHIEVEMENTS_CHANNEL,
        messageId: '323456789012345678',
      });
      expect(first).toEqual({ stored: true });
      expect(second).toEqual({ stored: false });
      expect(await getAchievementAnnouncement(kit.system, { memberAchievementId })).toBeNull();

      await revokeAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'first_project',
        reason: 'Duplicate project record.',
      });
      const [retract] = await jobsOf(DISCORD_ACHIEVEMENT_RETRACT_JOB);
      expect(retract?.payload).toEqual({
        memberAchievementId,
        channelId: ACHIEVEMENTS_CHANNEL,
        messageId: '223456789012345678',
      });
    });

    it('does not announce hidden awards, private profiles, or when disabled', async () => {
      await announceOn();
      const hiddenHolder = await kit.member();
      await emit('adversarial.revealed', hiddenHolder.memberId);
      const privateMember = await kit.member();
      await updateProfile(kit.as(privateMember), privateMember.memberId!, {
        profileVisibility: 'staff',
      });
      await emit('project.created', privateMember.memberId);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(hiddenHolder.memberId!)).toEqual(['adversary']);
      expect(await keysOf(privateMember.memberId!)).toEqual(['first_project']);
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toEqual([]);

      await updateSettings(kit.system, 'notifications', { announceAchievements: false });
      const quiet = await kit.member();
      await emit('project.created', quiet.memberId);
      await kit.drain(achievementTestHandlers);
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toEqual([]);
    });

    it('skips announcements when no channel is configured', async () => {
      const m = await kit.member();
      await emit('project.created', m.memberId);
      await kit.drain(achievementTestHandlers);
      expect(await keysOf(m.memberId!)).toEqual(['first_project']);
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toEqual([]);
    });
  });
});
