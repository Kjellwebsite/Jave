import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import {
  awardAchievement,
  createAchievementDefinition,
  listPendingAchievementAwards,
  revokeAchievement,
  verifyMemberAchievement,
} from './index';
import { DATABASE_SUITE_TIMEOUTS } from './testing/fixtures';

vi.setConfig(DATABASE_SUITE_TIMEOUTS);

describe('achievements — pending verification queue', () => {
  let kit: TestKit;
  let core: UserActor;
  let ops: UserActor;
  let holder: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
    ops = await kit.member({ roles: ['operations'] });
    holder = await kit.member({ roles: ['verified'] });
    await createAchievementDefinition(kit.as(core), {
      key: 'mentor',
      title: 'Mentor',
      summary: 'Brought someone else up to speed.',
      description: 'Mentored a member to a verified result.',
      category: 'leadership',
      criteria: { type: 'manual' },
      requiresVerification: true,
    });
  });
  afterEach(async () => {
    await kit.close();
  });

  it('lists unverified awards oldest first with the viewer flags', async () => {
    await awardAchievement(kit.as(ops), {
      memberId: holder.memberId!,
      key: 'mentor',
      reason: 'Mentored a trial team.',
    });
    kit.clock.advance(1000);
    await awardAchievement(kit.as(ops), {
      memberId: core.memberId!,
      key: 'mentor',
      reason: 'Ran the onboarding cohort.',
    });

    const asOps = await listPendingAchievementAwards(kit.as(ops));
    expect(asOps.total).toBe(2);
    expect(asOps.items.map((item) => item.memberId)).toEqual([holder.memberId, core.memberId]);
    expect(asOps.items[0]).toMatchObject({
      key: 'mentor',
      title: 'Mentor',
      rarity: 'standard',
      awardedByName: ops.displayName,
      note: 'Mentored a trial team.',
      isOwn: false,
      awardedByViewer: true,
    });

    const asCore = await listPendingAchievementAwards(kit.as(core));
    expect(asCore.items.map((item) => [item.isOwn, item.awardedByViewer])).toEqual([
      [false, false],
      [true, false],
    ]);

    await verifyMemberAchievement(kit.as(core), { memberId: holder.memberId!, key: 'mentor' });
    await revokeAchievement(kit.as(ops), {
      memberId: core.memberId!,
      key: 'mentor',
      reason: 'Awarded to the wrong person.',
    });
    expect((await listPendingAchievementAwards(kit.as(ops))).total).toBe(0);
  });

  it('leaves out deleted members', async () => {
    await awardAchievement(kit.as(ops), {
      memberId: holder.memberId!,
      key: 'mentor',
      reason: 'Mentored a trial team.',
    });
    await kit.db
      .update(members)
      .set({ deletedAt: kit.clock.now() })
      .where(eq(members.id, holder.memberId!));
    expect((await listPendingAchievementAwards(kit.as(ops))).items).toHaveLength(0);
  });

  it('BREAK: members and moderators cannot read the queue', async () => {
    await expect(listPendingAchievementAwards(kit.as(holder))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const moderator = await kit.member({ roles: ['moderator'] });
    await expect(listPendingAchievementAwards(kit.as(moderator))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
