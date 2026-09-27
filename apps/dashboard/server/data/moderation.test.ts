import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, moderation, updateSettings } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { parseCaseFilters, parseEventFilters } from '@/lib/moderation-labels';
import {
  loadCases,
  loadLookup,
  loadModerationSummary,
  loadPosture,
  loadSecurityEvents,
  visibleTabs,
} from './moderation';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

async function fixture() {
  const mod = kit.as(await kit.member({ roles: ['moderator'], username: 'warden' }));
  const target = await kit.member({ username: 'drifter' });
  const warning = await moderation.warnMember(mod, {
    targetUserId: target.userId,
    reason: 'Off-topic spam in general',
  });
  const quarantine = await moderation.quarantineMember(mod, {
    targetUserId: target.userId,
    reason: 'Phishing links reported by members',
  });
  const event = await moderation.recordSecurityEvent(kit.system, {
    targetUserId: target.userId,
    trigger: 'foreign_invite',
    riskScore: 61,
    excerpt: 'join my server discord.gg/abc',
    actionTaken: 'timeout',
  });
  return { mod, target, warning, quarantine, event };
}

describe('moderation read models', () => {
  it('summarises raid mode, open events and live restrictions', async () => {
    const { mod } = await fixture();
    expect(await loadModerationSummary(mod)).toEqual({
      raidMode: false,
      needsReview: 1,
      quarantined: 1,
      banned: 0,
    });
    await updateSettings(kit.system, 'security', { raidMode: true });
    expect((await loadModerationSummary(mod)).raidMode).toBe(true);
  });

  it('lists cases through the URL filters', async () => {
    const { mod, warning } = await fixture();
    const all = await loadCases(mod, parseCaseFilters({}));
    expect(all.items.map((c) => c.action)).toEqual(['quarantine', 'warn']);
    const byNumber = await loadCases(mod, parseCaseFilters({ q: warning.reference }));
    expect(byNumber.items.map((c) => c.id)).toEqual([warning.id]);
    const live = await loadCases(mod, parseCaseFilters({ state: 'live' }));
    expect(live.items.map((c) => c.action)).toEqual(['quarantine']);
  });

  it('lists security events for review, newest first', async () => {
    const { mod, event } = await fixture();
    const review = await loadSecurityEvents(mod, parseEventFilters({}));
    expect(review.items.map((e) => e.id)).toEqual([event.id]);
    await moderation.reviewSecurityEvent(mod, { securityEventId: event.id, status: 'dismissed' });
    expect((await loadSecurityEvents(mod, parseEventFilters({}))).total).toBe(0);
    expect((await loadSecurityEvents(mod, parseEventFilters({ view: 'dismissed' }))).total).toBe(1);
  });

  it('looks a member up by Discord ID or by name', async () => {
    const { mod, target } = await fixture();
    const byId = await loadLookup(mod, { query: target.discordId, discordId: target.discordId });
    expect(byId.history?.summary).toMatchObject({ warnings: 1, quarantined: true, totalCases: 2 });
    const byName = await loadLookup(mod, { query: 'drift', discordId: undefined });
    expect(byName.candidates.map((c) => c.discordId)).toEqual([target.discordId]);
    const unknown = await loadLookup(mod, {
      query: '199999999999999999',
      discordId: '199999999999999999',
    });
    expect(unknown).toEqual({ history: null, candidates: [] });
  });

  it('reports configuration gaps on the raid tab', async () => {
    const mod = kit.as(await kit.member({ roles: ['moderator'] }));
    expect(await loadPosture(mod)).toMatchObject({
      quarantineRoleConfigured: false,
      alertChannelConfigured: false,
    });
    // Alert cards post to the security alerts channel only; staff alerts is not a fallback.
    await updateSettings(kit.system, 'channels', { staffAlerts: '410000000000000001' });
    expect((await loadPosture(mod)).alertChannelConfigured).toBe(false);
    await updateSettings(kit.system, 'channels', { securityAlerts: '410000000000000002' });
    expect((await loadPosture(mod)).alertChannelConfigured).toBe(true);
  });

  it('BREAK: members see no tab and cannot load any moderation data', async () => {
    await fixture();
    const member = kit.as(await kit.member({ username: 'curious' }));
    expect(visibleTabs(member)).toEqual([]);
    await expect(loadModerationSummary(member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadCases(member, parseCaseFilters({}))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadSecurityEvents(member, parseEventFilters({}))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('BREAK: records about the viewer or higher-ranked staff read as no record', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const lead = await kit.member({ roles: ['operations'], username: 'lead' });
    const core = kit.as(await kit.member({ roles: ['core'] }));
    await moderation.warnMember(core, { targetUserId: mod.userId, reason: 'Late to review' });
    await moderation.warnMember(core, { targetUserId: lead.userId, reason: 'Missed handover' });
    const modCtx = kit.as(mod);
    expect(await loadLookup(modCtx, { query: mod.discordId, discordId: mod.discordId })).toEqual({
      history: null,
      candidates: [],
    });
    expect(
      (await loadLookup(modCtx, { query: lead.discordId, discordId: lead.discordId })).history,
    ).toBeNull();
    expect((await loadCases(modCtx, parseCaseFilters({}))).total).toBe(0);
    expect(visibleTabs(modCtx)).toEqual(['cases', 'security', 'lookup', 'raid']);
  });
});
