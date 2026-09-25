import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, members, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { DomainEventType } from '../events/catalog';
import { ConflictError, ForbiddenError, NotFoundError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { updateProfile } from '../identity/profile.service';
import {
  awardAchievement,
  createAchievementDefinition,
  deleteAchievementDefinition,
  DISCORD_ACHIEVEMENT_ANNOUNCE_JOB,
  getAchievementCatalog,
  getAchievementRarityStats,
  listMemberAchievements,
  revokeAchievement,
  seedStarterAchievements,
  STARTER_ACHIEVEMENTS,
  updateAchievementDefinition,
  verifyMemberAchievement,
} from './index';
import {
  DATABASE_SUITE_TIMEOUTS,
  achievementTestHandlers,
  emitEvents,
  enableAnnouncements,
  jobsOfType,
} from './testing/fixtures';

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

describe('achievements — staff actions and views', () => {
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
  const jobsOf = (type: string) => jobsOfType(kit, type);
  const announceOn = () => enableAnnouncements(kit);

  describe('manual awards and verification', () => {
    beforeEach(async () => {
      await seedStarterAchievements(kit.system);
      await createAchievementDefinition(kit.as(core), {
        key: 'mentor',
        title: 'Mentor',
        summary: 'Brought someone else up to speed.',
        description: 'Mentored a member to a verified result.',
        category: 'leadership',
        criteria: { type: 'manual' },
        requiresVerification: true,
      });
      await kit.drain(achievementTestHandlers);
      await announceOn();
    });

    it('awards manually with an audit trail and refuses duplicates', async () => {
      const m = await kit.member();
      const award = await awardAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'team_leader',
        reason: 'Led trial team 3 to a distinction.',
      });
      expect(award.verification).toBe('verified');
      expect(award.awardedByUserId).toBe(ops.userId);
      await expect(
        awardAchievement(kit.as(ops), {
          memberId: m.memberId!,
          key: 'team_leader',
          reason: 'Again.',
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'achievement.awarded'));
      expect(audit?.actorUserId).toBe(ops.userId);
      expect(audit?.context).toMatchObject({ key: 'team_leader' });
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toHaveLength(1);
    });

    it('requires a second person to verify awards that need verification', async () => {
      const m = await kit.member();
      const secondReviewer = await kit.member({ roles: ['operations'] });
      const award = await awardAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'mentor',
        reason: 'Mentored two trial participants.',
      });
      expect(award.verification).toBe('unverified');
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toEqual([]);
      await expect(
        verifyMemberAchievement(kit.as(ops), { memberId: m.memberId!, key: 'mentor' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const verified = await verifyMemberAchievement(kit.as(secondReviewer), {
        memberId: m.memberId!,
        key: 'mentor',
      });
      expect(verified.verification).toBe('verified');
      expect(verified.verifiedByUserId).toBe(secondReviewer.userId);
      expect(await jobsOf(DISCORD_ACHIEVEMENT_ANNOUNCE_JOB)).toHaveLength(1);
      await expect(
        verifyMemberAchievement(kit.as(secondReviewer), { memberId: m.memberId!, key: 'mentor' }),
      ).rejects.toThrow('already verified');
    });

    it('revokes with a reason, notifies the member and refuses unknown awards', async () => {
      const m = await kit.member();
      await awardAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'team_leader',
        reason: 'Led a team.',
      });
      const revoked = await revokeAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'team_leader',
        reason: 'Awarded to the wrong member.',
      });
      expect(revoked.revokedByUserId).toBe(ops.userId);
      expect(revoked.revokeReason).toBe('Awarded to the wrong member.');
      const inbox = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, m.userId));
      expect(inbox.map((n) => n.title)).toContain('ACHIEVEMENT REVOKED');
      await expect(
        revokeAchievement(kit.as(ops), {
          memberId: m.memberId!,
          key: 'team_leader',
          reason: 'Twice.',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('views', () => {
    beforeEach(async () => {
      await seedStarterAchievements(kit.system);
      await kit.drain(achievementTestHandlers);
    });

    it('masks hidden definitions until the viewer unlocks them; staff see all', async () => {
      const viewer = await kit.member();
      const masked = await getAchievementCatalog(kit.as(viewer));
      const hiddenCount = STARTER_ACHIEVEMENTS.filter((s) => s.visibility === 'hidden').length;
      expect(masked.filter((e) => e.masked)).toHaveLength(hiddenCount);
      for (const entry of masked.filter((e) => e.masked)) {
        expect(entry.title).toBe('HIDDEN');
        expect(JSON.stringify(entry)).not.toMatch(/adversar|relentless|keystone/i);
      }
      await emit('adversarial.revealed', viewer.memberId);
      await kit.drain(achievementTestHandlers);
      const revealed = await getAchievementCatalog(kit.as(viewer));
      const adversary = revealed.find((e) => !e.masked && e.key === 'adversary');
      expect(adversary).toMatchObject({ unlocked: true, verified: true });
      expect(revealed.filter((e) => e.masked)).toHaveLength(hiddenCount - 1);

      const staffView = await getAchievementCatalog(kit.as(ops));
      expect(staffView.every((e) => !e.masked)).toBe(true);
      const publicView = await getAchievementCatalog(kit.as(anonymousActor));
      expect(publicView.filter((e) => e.masked)).toHaveLength(hiddenCount);
    });

    it('lists member achievements following profile visibility', async () => {
      const holder = await kit.member();
      const other = await kit.member();
      await emit('project.created', holder.memberId);
      await kit.drain(achievementTestHandlers);
      const list = await listMemberAchievements(kit.as(other), { memberId: holder.memberId! });
      expect(list.map((a) => a.key)).toEqual(['first_project']);
      expect(list[0]).toMatchObject({ origin: 'rule', verified: true, revokedAt: null });

      await updateProfile(kit.as(holder), holder.memberId!, { profileVisibility: 'staff' });
      await expect(
        listMemberAchievements(kit.as(other), { memberId: holder.memberId! }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(
        await listMemberAchievements(kit.as(holder), { memberId: holder.memberId! }),
      ).toHaveLength(1);
      expect(
        await listMemberAchievements(kit.as(ops), { memberId: holder.memberId! }),
      ).toHaveLength(1);
    });

    it('shows revoked history to staff only', async () => {
      const holder = await kit.member();
      await emit('project.created', holder.memberId);
      await kit.drain(achievementTestHandlers);
      await revokeAchievement(kit.as(ops), {
        memberId: holder.memberId!,
        key: 'first_project',
        reason: 'Test project.',
      });
      await expect(
        listMemberAchievements(kit.as(holder), {
          memberId: holder.memberId!,
          includeRevoked: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const history = await listMemberAchievements(kit.as(ops), {
        memberId: holder.memberId!,
        includeRevoked: true,
      });
      expect(history[0]).toMatchObject({ key: 'first_project', revokeReason: 'Test project.' });
    });

    it('reports rarity as a share of active members', async () => {
      const viewer = await kit.member();
      const holder = await kit.member();
      const bannedHolder = await kit.member();
      await emit('project.created', holder.memberId);
      await emit('project.created', bannedHolder.memberId);
      await emit('adversarial.revealed', holder.memberId);
      await kit.drain(achievementTestHandlers);
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, bannedHolder.memberId!));
      const stats = await getAchievementRarityStats(kit.as(viewer));
      // core, ops, viewer, holder are active; the banned holder is not counted.
      expect(stats.activeMembers).toBe(4);
      const firstProject = stats.achievements.find((a) => !a.masked && a.key === 'first_project');
      expect(firstProject).toMatchObject({ holders: 1, percent: 25 });
      const maskedHidden = stats.achievements.filter((a) => a.masked);
      expect(maskedHidden.length).toBeGreaterThan(0);
      expect(maskedHidden.some((a) => a.holders === 1)).toBe(true);
    });
  });

  describe('definitions', () => {
    it('creates, updates with an audited diff, and deletes only unused definitions', async () => {
      const created = await createAchievementDefinition(kit.as(core), {
        key: 'verifier_proof',
        title: 'Proven',
        summary: 'Five verifications approved.',
        description: 'Five claims held up under independent verification.',
        category: 'verification',
        criteria: { type: 'event_count', event: 'verification.approved', threshold: 5 },
      });
      expect(created).toMatchObject({ rarity: 'standard', visibility: 'public', active: true });
      await expect(
        createAchievementDefinition(kit.as(core), {
          key: 'verifier_proof',
          title: 'Dup',
          summary: 'Dup.',
          description: 'Dup.',
          category: 'events',
          criteria: { type: 'manual' },
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await updateAchievementDefinition(kit.as(core), {
        key: 'verifier_proof',
        patch: {
          rarity: 'rare',
          criteria: { type: 'event_count', event: 'verification.approved', threshold: 7 },
        },
      });
      const [audit] = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'achievement.definition_updated'));
      expect(audit?.context).toMatchObject({
        changes: { rarity: { from: 'standard', to: 'rare' } },
      });
      await deleteAchievementDefinition(kit.as(core), { key: 'verifier_proof' });
      await expect(
        updateAchievementDefinition(kit.as(core), {
          key: 'verifier_proof',
          patch: { rarity: 'rare' },
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses to delete definitions with history', async () => {
      await seedStarterAchievements(kit.system);
      const m = await kit.member();
      await awardAchievement(kit.as(ops), {
        memberId: m.memberId!,
        key: 'team_leader',
        reason: 'Led a team.',
      });
      await expect(
        deleteAchievementDefinition(kit.as(core), { key: 'team_leader' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('validates facets and criteria against the catalogs', async () => {
      const base = {
        key: 'x_rule',
        title: 'Xenon',
        summary: 'X happened.',
        description: 'Something happened.',
        category: 'misc',
      };
      await expect(
        createAchievementDefinition(kit.as(core), {
          ...base,
          criteria: { type: 'manual' },
          facetKey: 'mind.telepathy',
        }),
      ).rejects.toThrow('Unknown capability.');
      for (const event of ['member.joined', 'event.checked_in', 'tournament.match_completed']) {
        await expect(
          createAchievementDefinition(kit.as(core), {
            ...base,
            criteria: { type: 'event_count', event, threshold: 1 },
          }),
          event,
        ).rejects.toThrow(/criteria\.event/);
      }
      await expect(
        createAchievementDefinition(kit.as(core), {
          ...base,
          criteria: { type: 'event_count', event: 'project.created', threshold: 5 },
        }),
      ).rejects.toThrow(/criteria\.threshold/);
    });
  });
});
