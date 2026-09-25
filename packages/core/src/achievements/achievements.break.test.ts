import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { achievementDefinitions, auditLogs, memberAchievements, members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { createEventHandlers, EVENT_DELIVER_JOB, publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { resolveUserActor } from '../identity/users.service';
import { anonymousActor, type UserActor } from '../permissions/actor';
import {
  ACHIEVEMENT_EVALUATE_JOB,
  awardAchievement,
  awardAchievementFromSystem,
  createAchievementDefinition,
  getAchievementAnnouncement,
  getAchievementCatalog,
  jobHandlers,
  markAchievementAnnounced,
  revokeAchievement,
  seedStarterAchievements,
  subscribers,
  updateAchievementDefinition,
  verifyMemberAchievement,
} from './index';
import { DATABASE_SUITE_TIMEOUTS } from './testing/fixtures';

const handlers = { ...jobHandlers, ...createEventHandlers(subscribers) };

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

describe('achievements — adversarial', () => {
  let kit: TestKit;
  let core: UserActor;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
    ops = await kit.member({ roles: ['operations'] });
    await seedStarterAchievements(kit.system);
    await kit.drain(handlers);
  });
  afterEach(async () => {
    await kit.close();
  });

  async function deniedAudits(action: string) {
    return kit.db.select().from(auditLogs).where(eq(auditLogs.action, action));
  }

  it('BREAK: staff cannot award, revoke or verify their own achievements', async () => {
    await expect(
      awardAchievement(kit.as(ops), { memberId: ops.memberId!, key: 'team_leader', reason: 'Me.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [blocked] = await deniedAudits('achievement.self_award_blocked');
    expect(blocked).toMatchObject({ result: 'denied', actorUserId: ops.userId });

    await awardAchievement(kit.as(core), {
      memberId: ops.memberId!,
      key: 'team_leader',
      reason: 'Led the ops rotation.',
    });
    await expect(
      revokeAchievement(kit.as(ops), {
        memberId: ops.memberId!,
        key: 'team_leader',
        reason: 'Oops.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      verifyMemberAchievement(kit.as(ops), { memberId: ops.memberId!, key: 'team_leader' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: members and moderators cannot award, revoke or define achievements', async () => {
    const member = await kit.member();
    const target = await kit.member();
    const moderator = await kit.member({ roles: ['moderator'] });
    for (const actor of [member, moderator]) {
      await expect(
        awardAchievement(kit.as(actor), {
          memberId: target.memberId!,
          key: 'team_leader',
          reason: 'Nice.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        revokeAchievement(kit.as(actor), {
          memberId: target.memberId!,
          key: 'team_leader',
          reason: 'No.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      createAchievementDefinition(kit.as(ops), {
        key: 'ops_made',
        title: 'Ops Made',
        summary: 'Made by ops.',
        description: 'Ops cannot define achievements.',
        category: 'misc',
        criteria: { type: 'manual' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateAchievementDefinition(kit.as(member), { key: 'builder', patch: { active: false } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await deniedAudits('access.denied')).length).toBeGreaterThanOrEqual(6);
    await expect(
      awardAchievement(kit.as(anonymousActor), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'Hi.',
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('BREAK: quarantined staff lose the ability to award', async () => {
    const target = await kit.member();
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, ops.memberId!));
    const quarantined = await resolveUserActor(kit.system, ops.userId);
    await expect(
      awardAchievement(kit.as(quarantined), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'Hm.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: only the system may grant automatically or drive the Discord callbacks', async () => {
    const target = await kit.member();
    await expect(
      awardAchievementFromSystem(kit.as(ops), {
        memberId: target.memberId!,
        key: 'builder',
        reason: 'Sneaky.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      awardAchievementFromSystem(kit.as(target), {
        memberId: target.memberId!,
        key: 'builder',
        reason: 'Sneaky.',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const award = await awardAchievement(kit.as(ops), {
      memberId: target.memberId!,
      key: 'team_leader',
      reason: 'Legit.',
    });
    await expect(
      markAchievementAnnounced(kit.as(target), {
        memberAchievementId: award.id,
        channelId: '123456789012345678',
        messageId: '223456789012345678',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getAchievementAnnouncement(kit.as(ops), { memberAchievementId: award.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: forged events cannot farm achievements for someone else or for nobody', async () => {
    const target = await kit.member();
    // Events of types that never count (Discord presence, self-claims) do nothing.
    for (let i = 0; i < 5; i++) {
      await publishEvent(kit.system, {
        type: 'member.joined',
        aggregateType: 'member',
        aggregateId: target.memberId!,
        subjectMemberId: target.memberId,
      });
      await publishEvent(kit.system, {
        type: 'capability.claimed',
        aggregateType: 'member',
        aggregateId: target.memberId!,
        subjectMemberId: target.memberId,
      });
    }
    await kit.drain(handlers);
    const rows = await kit.db
      .select()
      .from(memberAchievements)
      .where(eq(memberAchievements.memberId, target.memberId!));
    expect(rows).toEqual([]);
  });

  it('BREAK: malformed and oversized definitions are rejected', async () => {
    const valid = {
      key: 'valid_key',
      title: 'Valid',
      summary: 'Valid summary.',
      description: 'Valid description.',
      category: 'misc',
      criteria: { type: 'manual' as const },
    };
    const attempts: Record<string, unknown>[] = [
      { ...valid, key: 'Bad Key' },
      { ...valid, key: 'x' },
      { ...valid, key: `k${'a'.repeat(64)}` },
      { ...valid, key: "robert'); drop table achievement_definitions;--" },
      { ...valid, title: 'T'.repeat(65) },
      { ...valid, title: 'Line\nbreak' },
      { ...valid, summary: 'S'.repeat(121) },
      { ...valid, description: 'D'.repeat(1001) },
      { ...valid, description: 'Bell\u0007' },
      { ...valid, category: 'Has Spaces' },
      { ...valid, rarity: 'mythic' },
      { ...valid, visibility: 'secret' },
      { ...valid, ordinal: -1 },
      { ...valid, criteria: { type: 'event_count', event: 'project.shipped', threshold: -3 } },
      { ...valid, criteria: { type: 'event_count', event: 'project.shipped', threshold: 1e9 } },
      { ...valid, criteria: { type: 'event_count', event: '__proto__', threshold: 1 } },
      { ...valid, criteria: { type: 'manual', threshold: 1 } },
      { ...valid, extra: 'field' },
    ];
    for (const attempt of attempts) {
      await expect(
        createAchievementDefinition(kit.as(core), attempt as never),
        JSON.stringify(attempt).slice(0, 80),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: (await kit.member()).memberId!,
        key: 'team_leader',
        reason: 'R'.repeat(501),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: 'not-a-uuid',
        key: 'team_leader',
        reason: 'Valid.',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('BREAK: awarding unknown definitions, inactive definitions, or ghost members fails cleanly', async () => {
    const target = await kit.member();
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: target.memberId!,
        key: 'no_such_thing',
        reason: 'Try.',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: '00000000-0000-4000-8000-000000000000',
        key: 'team_leader',
        reason: 'Ghost.',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await updateAchievementDefinition(kit.as(core), {
      key: 'team_leader',
      patch: { active: false },
    });
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'Try.',
      }),
    ).rejects.toThrow('inactive');
    await kit.db
      .update(members)
      .set({ standing: 'banned' })
      .where(eq(members.id, target.memberId!));
    await updateAchievementDefinition(kit.as(core), {
      key: 'team_leader',
      patch: { active: true },
    });
    await expect(
      awardAchievement(kit.as(ops), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'Try.',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('BREAK: duplicate concurrent manual awards produce a single award', async () => {
    const target = await kit.member();
    const second = await kit.member({ roles: ['operations'] });
    const results = await Promise.allSettled([
      awardAchievement(kit.as(ops), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'First.',
      }),
      awardAchievement(kit.as(second), {
        memberId: target.memberId!,
        key: 'team_leader',
        reason: 'Second.',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rows = await kit.db
      .select()
      .from(memberAchievements)
      .where(
        and(
          eq(memberAchievements.memberId, target.memberId!),
          eq(memberAchievements.achievementKey, 'team_leader'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('BREAK: members cannot read inactive definitions through the catalog', async () => {
    const member = await kit.member();
    await expect(
      getAchievementCatalog(kit.as(member), { includeInactive: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('BREAK: a rule on Discord activity is inert, even when written straight to the database', async () => {
    const now = kit.clock.now();
    await kit.db.insert(achievementDefinitions).values({
      key: 'regular',
      title: 'Regular',
      summary: 'Checked in once.',
      description: 'Showed up.',
      category: 'events',
      criteria: { type: 'event_count', event: 'event.checked_in', threshold: 1 },
      createdAt: now,
      updatedAt: now,
    });
    await enqueueJob(kit.system, ACHIEVEMENT_EVALUATE_JOB, { key: 'regular' });
    const member = await kit.member();
    await publishEvent(kit.system, {
      type: 'event.checked_in',
      aggregateType: 'event',
      aggregateId: 'event-1',
      subjectMemberId: member.memberId,
    });
    const outcomes = await kit.drain(handlers);
    expect(outcomes.filter((o) => o.status !== 'completed')).toEqual([]);
    expect(outcomes.filter((o) => o.type === EVENT_DELIVER_JOB)).toEqual([]);
    const [evaluation] = outcomes.filter((o) => o.type === ACHIEVEMENT_EVALUATE_JOB);
    expect(evaluation?.result).toEqual({ skipped: 'not an active event_count rule' });
    const rows = await kit.db
      .select()
      .from(memberAchievements)
      .where(eq(memberAchievements.memberId, member.memberId!));
    expect(rows).toEqual([]);
  });
});
