import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, inviteCodes, referrals, users } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../kernel/errors';
import { DAY, HOUR } from '../kernel/clock';
import { anonymousActor } from '../permissions/actor';
import { recordGuildLeave } from '../identity/users.service';
import { attributeJoin } from './attribution.service';
import { attachInviteToCampaign, createCampaign } from './campaigns.service';
import { inviteUsageSnapshot, syncInvites } from './sync.service';
import { joinGuild, SLOW_DATABASE_TIMEOUTS, snowflakeAt } from './test-support';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('invites: mirror sync and join attribution', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function inviter(username = 'inviter') {
    const { user, member } = await joinGuild(kit, { username });
    return { user, member };
  }

  describe('syncInvites', () => {
    it('mirrors invites, creates unknown inviters minimally, never renames known users', async () => {
      const known = await inviter('Known_Name');
      const strangerId = snowflakeAt(new Date('2021-01-01T00:00:00Z'));
      const result = await syncInvites(kit.system, [
        { code: 'aaaa1111', inviterDiscordId: known.user.discordId, uses: 3, maxUses: 0 },
        {
          code: 'bbbb2222',
          inviterDiscordId: strangerId,
          inviterUsername: 'stranger',
          channelId: '123456789012345678',
          uses: 0,
          maxUses: 5,
          temporary: true,
          expiresAt: '2026-04-01T00:00:00.000Z',
        },
        {
          code: 'nothx',
          inviterDiscordId: known.user.discordId,
          inviterUsername: 'Hijack',
          uses: 1,
        },
      ]);
      expect(result).toEqual({ synced: 3, removed: 0, createdUsers: 1 });
      const [renamed] = await kit.db.select().from(users).where(eq(users.id, known.user.id));
      expect(renamed!.username).toBe('Known_Name');
      const rows = await kit.db.select().from(inviteCodes);
      const a = rows.find((r) => r.code === 'aaaa1111')!;
      expect(a.maxUses).toBeNull(); // Discord's 0 = unlimited
      expect(a.inviterUserId).toBe(known.user.id);
      const b = rows.find((r) => r.code === 'bbbb2222')!;
      expect(b.temporary).toBe(true);
      expect(b.expiresAt?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });

    it('marks vanished codes deleted, revives returning ones, keeps campaign links', async () => {
      const { user } = await inviter();
      const founder = await kit.member({ roles: ['founder'] });
      await syncInvites(kit.system, [
        { code: 'keep', inviterDiscordId: user.discordId, uses: 1 },
        { code: 'gone', inviterDiscordId: user.discordId, uses: 2 },
      ]);
      const campaign = await createCampaign(kit.as(founder), { key: 'spring', name: 'Spring' });
      await attachInviteToCampaign(kit.as(founder), { code: 'keep', campaignId: campaign.id });
      kit.clock.advance(HOUR);
      const second = await syncInvites(kit.system, [
        { code: 'keep', inviterDiscordId: user.discordId, uses: 4 },
      ]);
      expect(second.removed).toBe(1);
      const [gone] = await kit.db.select().from(inviteCodes).where(eq(inviteCodes.code, 'gone'));
      expect(gone!.deletedAt).not.toBeNull();
      const [keep] = await kit.db.select().from(inviteCodes).where(eq(inviteCodes.code, 'keep'));
      expect(keep!.uses).toBe(4);
      expect(keep!.campaignId).toBe(campaign.id);
      await syncInvites(kit.system, [
        { code: 'keep', inviterDiscordId: user.discordId, uses: 4 },
        { code: 'gone', inviterDiscordId: user.discordId, uses: 2 },
      ]);
      const [back] = await kit.db.select().from(inviteCodes).where(eq(inviteCodes.code, 'gone'));
      expect(back!.deletedAt).toBeNull();
      expect((await inviteUsageSnapshot(kit.system)).map((i) => i.code).sort()).toEqual([
        'gone',
        'keep',
      ]);
    });

    it('an empty snapshot means the guild has no invites', async () => {
      const { user } = await inviter();
      await syncInvites(kit.system, [{ code: 'solo', inviterDiscordId: user.discordId, uses: 0 }]);
      expect((await syncInvites(kit.system, [])).removed).toBe(1);
    });

    it('BREAK: users — even founders — cannot write the invite mirror; denial is audited', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await expect(
        syncInvites(kit.as(founder), [
          { code: 'fake', inviterDiscordId: founder.discordId, uses: 999 },
        ]),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(inviteUsageSnapshot(kit.as(founder))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(syncInvites(kit.as(anonymousActor), [])).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      const denials = await kit.db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.actorUserId, founder.userId)),
        );
      expect(denials.length).toBe(2);
      expect(await kit.db.select().from(inviteCodes)).toHaveLength(0);
    });

    it('BREAK: rejects malformed, duplicate, oversized and injection-shaped snapshots', async () => {
      const bad = [
        [{ code: "x'; drop table invite_codes;--", uses: 1 }],
        [{ code: 'ok-code', uses: -1 }],
        [{ code: 'ok-code', uses: 1.5 }],
        [{ code: 'ok-code', uses: 1, inviterDiscordId: 'not-a-snowflake' }],
        [
          { code: 'dup', uses: 1 },
          { code: 'dup', uses: 2 },
        ],
        [
          { code: 'vanity1', uses: 1, vanity: true },
          { code: 'vanity2', uses: 1, vanity: true },
        ],
        Array.from({ length: 1001 }, (_, i) => ({ code: `c${i}`, uses: 0 })),
        [
          ...Array.from({ length: 1001 }, (_, i) => ({ code: `c${i}`, uses: 0 })),
          { code: 'vanity', uses: 0, vanity: true },
        ],
      ];
      for (const snapshot of bad) {
        await expect(syncInvites(kit.system, snapshot)).rejects.toBeInstanceOf(ValidationError);
      }
      expect(await kit.db.select().from(inviteCodes)).toHaveLength(0);
    });

    it('accepts a guild at the invite cap that also has a vanity URL', async () => {
      const full = [
        ...Array.from({ length: 1000 }, (_, i) => ({ code: `c${i}`, uses: 0 })),
        { code: 'javelin', uses: 7, vanity: true },
      ];
      expect((await syncInvites(kit.system, full)).synced).toBe(1001);
    });
  });

  describe('attributeJoin', () => {
    it('credits the invite’s inviter and records a referral.recorded event', async () => {
      const a = await inviter('alice');
      await syncInvites(kit.system, [
        { code: 'alice01', inviterDiscordId: a.user.discordId, uses: 0 },
      ]);
      kit.clock.advance(HOUR);
      const joined = await joinGuild(kit, { username: 'newcomer' });
      const { referral, created } = await attributeJoin(kit.system, {
        inviteeUserId: joined.user.id,
        usedCode: 'alice01',
        joinedAt: kit.clock.now(),
      });
      expect(created).toBe(true);
      expect(referral).toMatchObject({
        method: 'invite',
        status: 'joined',
        inviterUserId: a.user.id,
        inviteCode: 'alice01',
        anomalyFlags: [],
        anomalyScore: 0,
      });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'referral.recorded'));
      expect(events).toHaveLength(1);
      expect(events[0]!.subjectMemberId).toBe(joined.member.id);
    });

    it('vanity and unknown joins credit nobody; an unmirrored code is kept for tracing', async () => {
      const { user: v } = await inviter('vanity-owner');
      await syncInvites(kit.system, [{ code: 'javelin', uses: 10, vanity: true }]);
      const x = await joinGuild(kit, { username: 'viaVanity' });
      const y = await joinGuild(kit, { username: 'viaNothing' });
      const z = await joinGuild(kit, { username: 'viaGhost' });
      const now = kit.clock.now();
      const byVanity = await attributeJoin(kit.system, {
        inviteeUserId: x.user.id,
        usedCode: 'javelin',
        joinedAt: now,
      });
      const unknown = await attributeJoin(kit.system, {
        inviteeUserId: y.user.id,
        usedCode: null,
        joinedAt: now,
      });
      const ghost = await attributeJoin(kit.system, {
        inviteeUserId: z.user.id,
        usedCode: 'neverseen',
        joinedAt: now,
      });
      expect(byVanity.referral).toMatchObject({ method: 'vanity', inviterUserId: null });
      expect(unknown.referral).toMatchObject({ method: 'unknown', inviteCode: null });
      expect(ghost.referral).toMatchObject({
        method: 'unknown',
        inviteCode: 'neverseen',
        inviterUserId: null,
      });
      expect(v).toBeTruthy();
    });

    it('credits a campaign only while it accepts attributions', async () => {
      const a = await inviter('alice');
      const founder = await kit.member({ roles: ['founder'] });
      await syncInvites(kit.system, [
        { code: 'camp1', inviterDiscordId: a.user.discordId, uses: 0 },
      ]);
      const campaign = await createCampaign(kit.as(founder), {
        key: 'launch',
        name: 'Launch',
        endsAt: new Date(kit.clock.now().getTime() + DAY),
      });
      await attachInviteToCampaign(kit.as(founder), { code: 'camp1', campaignId: campaign.id });
      const early = await joinGuild(kit, { username: 'early' });
      const r1 = await attributeJoin(kit.system, {
        inviteeUserId: early.user.id,
        usedCode: 'camp1',
        joinedAt: kit.clock.now(),
      });
      expect(r1.referral.campaignId).toBe(campaign.id);
      kit.clock.advance(2 * DAY);
      const late = await joinGuild(kit, { username: 'late' });
      const r2 = await attributeJoin(kit.system, {
        inviteeUserId: late.user.id,
        usedCode: 'camp1',
        joinedAt: kit.clock.now(),
      });
      expect(r2.referral.campaignId).toBeNull();
      expect(r2.referral.inviterUserId).toBe(a.user.id);
    });

    it('credits a max-uses invite even after Discord deleted it', async () => {
      const a = await inviter('alice');
      await syncInvites(kit.system, [
        { code: 'oneshot', inviterDiscordId: a.user.discordId, uses: 0, maxUses: 1 },
      ]);
      await syncInvites(kit.system, []);
      const joined = await joinGuild(kit, { username: 'lastUse' });
      const { referral } = await attributeJoin(kit.system, {
        inviteeUserId: joined.user.id,
        usedCode: 'oneshot',
        joinedAt: kit.clock.now(),
      });
      expect(referral.inviterUserId).toBe(a.user.id);
    });

    it('is idempotent per invitee + joinedAt, including concurrent duplicates', async () => {
      const a = await inviter('alice');
      await syncInvites(kit.system, [
        { code: 'alice01', inviterDiscordId: a.user.discordId, uses: 0 },
      ]);
      const joined = await joinGuild(kit, { username: 'twice' });
      const input = {
        inviteeUserId: joined.user.id,
        usedCode: 'alice01',
        joinedAt: kit.clock.now(),
      };
      const results = await Promise.all([
        attributeJoin(kit.system, input),
        attributeJoin(kit.system, input),
        attributeJoin(kit.system, input),
      ]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.referral.id)).size).toBe(1);
      expect(await kit.db.select().from(referrals)).toHaveLength(1);
    });

    it('BREAK: a self-invite is flagged, scored 100, invalid and audited', async () => {
      const a = await inviter('selfie');
      await syncInvites(kit.system, [
        { code: 'selfie1', inviterDiscordId: a.user.discordId, uses: 0 },
      ]);
      await recordGuildLeave(kit.system, a.user.discordId);
      kit.clock.advance(HOUR);
      await joinGuild(kit, { username: 'selfie', discordId: a.user.discordId });
      const { referral } = await attributeJoin(kit.system, {
        inviteeUserId: a.user.id,
        usedCode: 'selfie1',
        joinedAt: kit.clock.now(),
      });
      expect(referral.status).toBe('invalid');
      expect(referral.statusReason).toBe('self_invite');
      expect(referral.anomalyFlags).toContain('self_invite');
      expect(referral.anomalyScore).toBe(100);
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'referral.self_invite_flagged'));
      expect(audit).toHaveLength(1);
    });

    it('a rejoin closes the earlier live referral and is flagged', async () => {
      const a = await inviter('alice');
      const b = await inviter('bob');
      await syncInvites(kit.system, [
        { code: 'alice01', inviterDiscordId: a.user.discordId, uses: 0 },
        { code: 'bob01', inviterDiscordId: b.user.discordId, uses: 0 },
      ]);
      const first = await joinGuild(kit, { username: 'hopper' });
      const r1 = await attributeJoin(kit.system, {
        inviteeUserId: first.user.id,
        usedCode: 'alice01',
        joinedAt: kit.clock.now(),
      });
      kit.clock.advance(2 * DAY);
      await joinGuild(kit, { username: 'hopper', discordId: first.user.discordId });
      const r2 = await attributeJoin(kit.system, {
        inviteeUserId: first.user.id,
        usedCode: 'bob01',
        joinedAt: kit.clock.now(),
      });
      expect(r2.referral.anomalyFlags).toContain('rejoin');
      expect(r2.referral.status).toBe('joined');
      const [old] = await kit.db.select().from(referrals).where(eq(referrals.id, r1.referral.id));
      expect(old).toMatchObject({ status: 'left', statusReason: 'superseded' });
    });

    it('flags an inviter’s join burst of very new, similarly named accounts', async () => {
      const farmer = await inviter('farmer');
      await syncInvites(kit.system, [
        { code: 'farm01', inviterDiscordId: farmer.user.discordId, uses: 0 },
      ]);
      let last = null;
      for (let i = 1; i <= 5; i++) {
        kit.clock.advance(5 * 60_000);
        const bot = await joinGuild(kit, {
          username: `farm_acct_${i}`,
          accountCreatedAt: new Date(kit.clock.now().getTime() - HOUR),
        });
        last = await attributeJoin(kit.system, {
          inviteeUserId: bot.user.id,
          usedCode: 'farm01',
          joinedAt: kit.clock.now(),
        });
      }
      expect(last!.referral.anomalyFlags).toEqual(
        expect.arrayContaining([
          'new_account',
          'join_burst',
          'new_account_share',
          'similar_usernames',
        ]),
      );
      expect(last!.referral.anomalyScore).toBe(100);
    });

    it('BREAK: rejects bot accounts, unknown users, future join times and bad codes', async () => {
      const bot = await kit.db
        .insert(users)
        .values({ discordId: snowflakeAt(new Date('2020-01-01')), username: 'robot', isBot: true })
        .returning();
      await expect(
        attributeJoin(kit.system, { inviteeUserId: bot[0]!.id, usedCode: null }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        attributeJoin(kit.system, {
          inviteeUserId: '00000000-0000-4000-8000-000000000000',
          usedCode: null,
        }),
      ).rejects.toThrow('User not found');
      const joined = await joinGuild(kit, { username: 'timetraveler' });
      await expect(
        attributeJoin(kit.system, {
          inviteeUserId: joined.user.id,
          usedCode: null,
          joinedAt: new Date(kit.clock.now().getTime() + DAY),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        attributeJoin(kit.system, { inviteeUserId: joined.user.id, usedCode: '../../etc' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        attributeJoin(kit.system, { inviteeUserId: 'not-a-uuid', usedCode: null }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('BREAK: members cannot attribute joins to themselves', async () => {
      const m = await kit.member();
      await expect(
        attributeJoin(kit.as(m), { inviteeUserId: m.userId, usedCode: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
