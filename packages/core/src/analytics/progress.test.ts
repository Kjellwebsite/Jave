import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberCapabilities, members, rankTiers } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { getJavelinProgress } from './progress.service';
import { SLOW_DATABASE_TIMEOUTS } from '../invites/test-support';
import { fixtures } from './test-fixtures';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('analytics: JAVELIN progress', () => {
  let kit: TestKit;
  let ops: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    ops = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  async function capability(
    memberId: string,
    facetKey: string,
    ranks: { claimed?: string; verified?: string },
  ) {
    await kit.db.insert(memberCapabilities).values({
      memberId,
      facetKey,
      claimedRank: ranks.claimed ?? null,
      verifiedRank: ranks.verified ?? null,
    });
  }

  it('counts proven outcomes all-time', async () => {
    const seed = fixtures(kit);
    const m = (await kit.member()).memberId!;
    const trial = await seed.trial('completed', kit.clock.now());
    await seed.trialResult(trial, m, 'distinction', kit.clock.now());
    await seed.trialResult(trial, ops.memberId!, 'fail', kit.clock.now());
    const draftTrial = await seed.trial('evaluating');
    await seed.trialResult(draftTrial, m, 'pass', null); // unpublished: not yet a fact
    await seed.project(m, 'shipped', { shippedAt: kit.clock.now() });
    await seed.project(m, 'testing');
    await seed.contribution(m, 'verified', kit.clock.now());
    await seed.contribution(m, 'rejected', null);
    const mission = await seed.mission('open');
    await seed.assignment(mission, m, 'verified', kit.clock.now());
    const progress = await getJavelinProgress(kit.as(ops));
    expect(progress).toMatchObject({
      trialsPassed: 1,
      projectsShipped: 1,
      verifiedContributions: 1,
      missionsCompleted: 1,
    });
  });

  it('counts present members per progression role', async () => {
    await kit.member({ roles: ['verified'] });
    await kit.member({ roles: ['verified'] });
    await kit.member({ roles: ['trial'] });
    await kit.member({ roles: ['applicant'] });
    const gone = await kit.member({ roles: ['verified'] });
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, gone.memberId!));
    const progress = await getJavelinProgress(kit.as(ops));
    // ops holds the MEMBER progression role alongside OPERATIONS.
    expect(progress.progression).toEqual({ verified: 2, trial: 1, applicant: 1, member: 1 });
  });

  it('distributes verified capability by peak tier per domain; claims and unknowns separate', async () => {
    const a = (await kit.member()).memberId!;
    const b = (await kit.member()).memberId!;
    const c = (await kit.member()).memberId!;
    const departed = await kit.member();
    await capability(a, 'mind.reasoning', { verified: 'C' });
    await capability(a, 'mind.research', { verified: 'B', claimed: 'A' });
    await capability(b, 'mind.knowledge', { claimed: 'A' });
    await capability(c, 'create.technical', { verified: 'S' });
    await capability(c, 'create.creative', { claimed: 'B' });
    await capability(departed.memberId!, 'mind.reasoning', { verified: 'S' });
    await kit.db
      .update(members)
      .set({ guildStatus: 'departed' })
      .where(eq(members.id, departed.memberId!));

    const progress = await getJavelinProgress(kit.as(ops));
    expect(progress.presentMembers).toBe(4);
    const mind = progress.capabilityDistribution.find((d) => d.domainKey === 'mind')!;
    expect(mind.tiers.filter((t) => t.count > 0)).toEqual([{ code: 'B', label: 'B', count: 1 }]);
    expect(mind).toMatchObject({ verified: 1, claimedOnly: 1, unknown: 2 });
    const create = progress.capabilityDistribution.find((d) => d.domainKey === 'create')!;
    expect(create.tiers.find((t) => t.code === 'S')!.count).toBe(1);
    expect(create).toMatchObject({ verified: 1, claimedOnly: 0, unknown: 3 });
    const body = progress.capabilityDistribution.find((d) => d.domainKey === 'body')!;
    expect(body).toMatchObject({ verified: 0, claimedOnly: 0, unknown: 4 });
    // No cross-domain aggregate exists anywhere in the payload.
    expect(Object.keys(progress)).not.toContain('score');
  });

  it('keeps counting ranks on tiers that were later disabled', async () => {
    const a = (await kit.member()).memberId!;
    await capability(a, 'body.physical', { verified: 'S' });
    await kit.db.update(rankTiers).set({ enabled: false }).where(eq(rankTiers.code, 'S'));
    kit.cache.clear();
    const progress = await getJavelinProgress(kit.as(ops));
    const body = progress.capabilityDistribution.find((d) => d.domainKey === 'body')!;
    expect(body.tiers.find((t) => t.code === 'S')?.count).toBe(1);
  });

  it('BREAK: members cannot read JAVELIN progress analytics', async () => {
    const m = await kit.member({ roles: ['verified'] });
    await expect(getJavelinProgress(kit.as(m))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
