import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DAY, ForbiddenError, invites, updateSettings, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { auditLogs, referrals } from '@jave/database';
import { loadAnalytics, loadHealthStrip, TREND_METRICS } from './analytics';
import { loadCampaignPage, loadReferralsPage } from './referrals';

let kit: TestKit;
let operations: UserActor;
let core: UserActor;
let member: UserActor;

beforeEach(async () => {
  kit = await createTestKit();
  operations = await kit.member({ roles: ['operations'] });
  core = await kit.member({ roles: ['core'] });
  member = await kit.member({ roles: ['member'] });
});

afterEach(async () => {
  await kit.close();
});

async function deniedAudits(): Promise<number> {
  const rows = await kit.db.select().from(auditLogs).where(eq(auditLogs.action, 'access.denied'));
  return rows.length;
}

describe('analytics page data', () => {
  it('loads the overview, progress and every charted series for analytics staff', async () => {
    const result = await loadAnalytics(kit.as(operations), 7);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.view.overview.rangeDays).toBe(7);
    expect(Object.keys(result.view.series).sort()).toEqual([...TREND_METRICS].sort());
    for (const series of Object.values(result.view.series)) expect(series.points).toHaveLength(7);
    expect(result.view.progress.capabilityDistribution.length).toBeGreaterThan(0);
  });

  it('BREAK: a member is refused once — one audited denial, not one per query', async () => {
    const before = await deniedAudits();
    await expect(loadAnalytics(kit.as(member), 30)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await deniedAudits()) - before).toBe(1);
  });

  it('reports the kill switch instead of failing', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await updateSettings(kit.as(founder), 'analytics', { enabled: false });
    expect(await loadAnalytics(kit.as(operations), 30)).toEqual({ status: 'disabled' });
    expect(await loadHealthStrip(kit.as(operations))).toBeNull();
  });

  it('the overview strip is for analytics staff only and never logs a denial', async () => {
    const before = await deniedAudits();
    expect(await loadHealthStrip(kit.as(member))).toBeNull();
    expect(await deniedAudits()).toBe(before);
    const strip = await loadHealthStrip(kit.as(operations));
    expect(strip?.rangeDays).toBe(30);
  });
});

describe('referrals page data', () => {
  async function seed() {
    const inviter = await kit.member({ username: 'ada' });
    await invites.syncInvites(kit.system, [
      { code: 'ada-inv', inviterDiscordId: inviter.discordId, uses: 5 },
      { code: 'spare', inviterDiscordId: inviter.discordId, uses: 1 },
    ]);
    const statuses = [
      { status: 'retained' as const, flags: ['join_burst'] },
      { status: 'left' as const, flags: ['fast_leave'] },
      { status: 'invalid' as const, flags: ['self_invite'] },
      { status: 'valid' as const, flags: [] },
    ];
    for (const [index, state] of statuses.entries()) {
      kit.clock.advance(DAY);
      const invitee = await kit.member({ username: `invitee${index}` });
      const { referral } = await invites.attributeJoin(kit.system, {
        inviteeUserId: invitee.userId,
        usedCode: 'ada-inv',
        joinedAt: kit.clock.now(),
      });
      await kit.db
        .update(referrals)
        .set({ status: state.status, anomalyFlags: state.flags, anomalyScore: 30 })
        .where(eq(referrals.id, referral.id));
    }
    const campaign = await invites.createCampaign(kit.as(core), { key: 'fair', name: 'Fair' });
    await invites.attachInviteToCampaign(kit.as(core), {
      code: 'ada-inv',
      campaignId: campaign.id,
    });
    return campaign;
  }

  it('counts every tab and queues only referrals a reviewer can act on', async () => {
    await seed();
    const page = await loadReferralsPage(kit.as(operations), { tab: 'review', offset: 0 });
    expect(page.funnel.joined).toBe(4);
    expect(page.counts).toEqual({ inviters: 1, campaigns: 1, review: 1, invites: 2 });
    expect(page.data.tab).toBe('review');
    if (page.data.tab !== 'review') return;
    expect(page.data.page.items.map((item) => item.status)).toEqual(['retained']);
  });

  it('filters inviter funnels by campaign', async () => {
    const campaign = await seed();
    const all = await loadReferralsPage(kit.as(operations), { tab: 'inviters', offset: 0 });
    const scoped = await loadReferralsPage(kit.as(operations), {
      tab: 'inviters',
      offset: 0,
      campaignId: campaign.id,
    });
    if (all.data.tab !== 'inviters' || scoped.data.tab !== 'inviters') throw new Error('tab');
    expect(all.data.page.items[0]!.funnel.joined).toBe(4);
    // Attaching never rewrites history: earlier joins stay uncredited.
    expect(scoped.data.page.total).toBe(0);
  });

  it('offers only invites not yet attached on the campaign page', async () => {
    const campaign = await seed();
    const page = await loadCampaignPage(kit.as(operations), campaign.id, 0);
    expect(page.attached.map((invite) => invite.code)).toEqual(['ada-inv']);
    expect(page.attachable.map((invite) => invite.code)).toEqual(['spare']);
  });

  it('BREAK: members cannot read referral data, and are refused once', async () => {
    await seed();
    const before = await deniedAudits();
    await expect(
      loadReferralsPage(kit.as(member), { tab: 'inviters', offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await deniedAudits()) - before).toBe(1);
  });
});
