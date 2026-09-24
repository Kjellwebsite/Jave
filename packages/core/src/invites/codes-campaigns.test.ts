import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, members, referralCodes, referrals } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { DAY } from '../kernel/clock';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import { attributeJoin } from './attribution.service';
import {
  attachInviteToCampaign,
  campaignAccepts,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from './campaigns.service';
import { MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER, REFERRAL_CLAIM_RATE_LIMIT } from './constants';
import {
  claimReferralCode,
  createReferralCode,
  deactivateReferralCode,
} from './referral-codes.service';
import { syncInvites } from './sync.service';
import { joinGuild, SLOW_DATABASE_TIMEOUTS } from './test-support';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('invites: referral codes and campaigns', () => {
  let kit: TestKit;
  let core: UserActor;
  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  describe('campaigns', () => {
    it('supports create, read, update, delete with audit', async () => {
      const c = await createCampaign(kit.as(core), {
        key: '  Spring-2026 ',
        name: 'Spring intake',
        description: 'Builders from the spring hackathon.',
      });
      expect(c.key).toBe('spring-2026');
      const updated = await updateCampaign(kit.as(core), { campaignId: c.id, active: false });
      expect(updated.active).toBe(false);
      expect((await listCampaigns(kit.as(core))).map((x) => x.id)).not.toContain(c.id);
      const all = await listCampaigns(kit.as(core), { includeInactive: true });
      expect(all.find((x) => x.id === c.id)?.funnel.joined).toBe(0);
      const view = await getCampaign(kit.as(core), c.id);
      expect(view.acceptingNow).toBe(false);
      await deleteCampaign(kit.as(core), c.id);
      await expect(getCampaign(kit.as(core), c.id)).rejects.toBeInstanceOf(NotFoundError);
      const actions = (await kit.db.select().from(auditLogs)).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['campaign.created', 'campaign.updated', 'campaign.deleted']),
      );
    });

    it('rejects duplicate keys and inverted windows', async () => {
      await createCampaign(kit.as(core), { key: 'dup', name: 'One' });
      await expect(
        createCampaign(kit.as(core), { key: 'dup', name: 'Two' }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        createCampaign(kit.as(core), {
          key: 'inverted',
          name: 'Inverted',
          startsAt: '2026-05-01T00:00:00Z',
          endsAt: '2026-04-01T00:00:00Z',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      const c = await createCampaign(kit.as(core), {
        key: 'window',
        name: 'Window',
        startsAt: '2026-05-01T00:00:00Z',
      });
      await expect(
        updateCampaign(kit.as(core), { campaignId: c.id, endsAt: '2026-04-01T00:00:00Z' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('campaign window check is inclusive of start and exclusive of end', () => {
      const window = {
        active: true,
        startsAt: new Date('2026-05-01T00:00:00Z'),
        endsAt: new Date('2026-06-01T00:00:00Z'),
      };
      expect(campaignAccepts(window, new Date('2026-05-01T00:00:00Z'))).toBe(true);
      expect(campaignAccepts(window, new Date('2026-06-01T00:00:00Z'))).toBe(false);
      expect(campaignAccepts(window, new Date('2026-04-30T23:59:59Z'))).toBe(false);
      expect(campaignAccepts({ ...window, active: false }, new Date('2026-05-10'))).toBe(false);
    });

    it('refuses to delete a campaign with attributed activity', async () => {
      const inviter = await joinGuild(kit, { username: 'inviter' });
      await syncInvites(kit.system, [
        { code: 'camp-inv', inviterDiscordId: inviter.user.discordId, uses: 0 },
      ]);
      const c = await createCampaign(kit.as(core), { key: 'busy', name: 'Busy' });
      await attachInviteToCampaign(kit.as(core), { code: 'camp-inv', campaignId: c.id });
      await expect(deleteCampaign(kit.as(core), c.id)).rejects.toBeInstanceOf(ConflictError);
    });

    it('BREAK: operations (no canManageCampaigns) cannot manage campaigns but can read them', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      await expect(
        createCampaign(kit.as(ops), { key: 'rogue', name: 'Rogue' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const c = await createCampaign(kit.as(core), { key: 'legit', name: 'Legit' });
      await expect(
        updateCampaign(kit.as(ops), { campaignId: c.id, name: 'Hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteCampaign(kit.as(ops), c.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        attachInviteToCampaign(kit.as(ops), { code: 'whatever', campaignId: c.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await listCampaigns(kit.as(ops))).toHaveLength(1);
      const member = await kit.member();
      await expect(listCampaigns(kit.as(member))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listCampaigns(kit.as(anonymousActor))).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });

    it('BREAK: rejects huge and hostile campaign input', async () => {
      await expect(
        createCampaign(kit.as(core), { key: 'x'.repeat(49), name: 'Long' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createCampaign(kit.as(core), { key: '<script>', name: 'XSS' }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        createCampaign(kit.as(core), { key: 'ok', name: 'N', description: 'd'.repeat(2001) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        attachInviteToCampaign(kit.as(core), { code: 'nope', campaignId: 'not-a-uuid' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('referral codes', () => {
    it('members create their own random codes up to the cap', async () => {
      const m = await kit.member();
      const codes = [];
      for (let i = 0; i < MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER; i++) {
        codes.push(await createReferralCode(kit.as(m)));
      }
      expect(new Set(codes.map((c) => c.code)).size).toBe(MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER);
      for (const c of codes) expect(c.code).toMatch(/^[A-Z2-9]{8}$/);
      await expect(createReferralCode(kit.as(m))).rejects.toBeInstanceOf(ConflictError);
      await deactivateReferralCode(kit.as(m), { code: codes[0]!.code });
      await expect(createReferralCode(kit.as(m))).resolves.toBeTruthy();
    });

    it('BREAK: a burst of concurrent creations cannot exceed the cap', async () => {
      const m = await kit.member();
      const attempts = MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER + 3;
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () => createReferralCode(kit.as(m))),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
        MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER,
      );
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      }
      const active = await kit.db
        .select()
        .from(referralCodes)
        .where(and(eq(referralCodes.ownerUserId, m.userId), eq(referralCodes.active, true)));
      expect(active).toHaveLength(MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER);
    });

    it('staff issue campaign codes with a chosen code, for another member', async () => {
      const ambassador = await kit.member();
      const c = await createCampaign(kit.as(core), { key: 'ambassadors', name: 'Ambassadors' });
      const code = await createReferralCode(kit.as(core), {
        campaignId: c.id,
        ownerMemberId: ambassador.memberId!,
        code: 'build-2026',
      });
      expect(code).toMatchObject({
        code: 'BUILD-2026',
        ownerUserId: ambassador.userId,
        campaignId: c.id,
        createdByUserId: core.userId,
      });
      await expect(
        createReferralCode(kit.as(core), {
          code: 'BUILD-2026',
          ownerMemberId: ambassador.memberId!,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('BREAK: members cannot pick codes, attach campaigns, or issue codes for others', async () => {
      const m = await kit.member();
      const other = await kit.member();
      const c = await createCampaign(kit.as(core), { key: 'vip', name: 'VIP' });
      await expect(createReferralCode(kit.as(m), { code: 'VANITY' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(createReferralCode(kit.as(m), { campaignId: c.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        createReferralCode(kit.as(m), { ownerMemberId: other.memberId! }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createReferralCode(kit.as(core), { code: "A'; --" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('BREAK: members in bad standing cannot create codes', async () => {
      const m = await kit.member();
      await kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, m.memberId!));
      await expect(createReferralCode(kit.as(m))).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('BREAK: nobody deactivates someone else’s code without canManageCampaigns', async () => {
      const owner = await kit.member();
      const attacker = await kit.member({ roles: ['moderator'] });
      const code = await createReferralCode(kit.as(owner));
      await expect(
        deactivateReferralCode(kit.as(attacker), { code: code.code }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const staffOff = await deactivateReferralCode(kit.as(core), {
        code: code.code.toLowerCase(),
      });
      expect(staffOff.active).toBe(false);
      await expect(
        deactivateReferralCode(kit.as(owner), { code: 'ZZZZZZZZ' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('claimReferralCode', () => {
    async function newcomer(username: string) {
      const joined = await joinGuild(kit, { username });
      return { ...joined, actor: await resolveUserActor(kit.system, joined.user.id) };
    }

    it('re-attributes the live referral to the code owner, once', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      const n = await newcomer('newbie');
      await attributeJoin(kit.system, {
        inviteeUserId: n.user.id,
        usedCode: null,
        joinedAt: kit.clock.now(),
      });
      const result = await claimReferralCode(kit.as(n.actor), { code: code.code.toLowerCase() });
      expect(result.status).toBe('joined');
      const rows = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.inviteeUserId, n.user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        method: 'referral_code',
        inviterUserId: owner.userId,
        referralCode: code.code,
      });
      const second = await createReferralCode(kit.as(owner));
      await expect(
        claimReferralCode(kit.as(n.actor), { code: second.code }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('creates the referral when the join was never attributed', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      const n = await newcomer('untracked');
      await claimReferralCode(kit.as(n.actor), { code: code.code });
      const [row] = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.inviteeUserId, n.user.id));
      expect(row).toMatchObject({ status: 'joined', method: 'referral_code' });
    });

    it('BREAK: own code is refused and audited', async () => {
      const n = await newcomer('selfref');
      const code = await createReferralCode(kit.as(n.actor));
      await expect(claimReferralCode(kit.as(n.actor), { code: code.code })).rejects.toBeInstanceOf(
        ValidationError,
      );
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'referral.self_claim_blocked'));
      expect(blocked).toHaveLength(1);
      expect(await kit.db.select().from(referrals)).toHaveLength(0);
    });

    it('BREAK: inactive, unknown and banned-owner codes all read as not found', async () => {
      const owner = await kit.member();
      const n = await newcomer('prober');
      const code = await createReferralCode(kit.as(owner));
      await deactivateReferralCode(kit.as(owner), { code: code.code });
      await expect(claimReferralCode(kit.as(n.actor), { code: code.code })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(claimReferralCode(kit.as(n.actor), { code: 'NOPE1234' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const banned = await kit.member();
      const bannedCode = await createReferralCode(kit.as(banned));
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, banned.memberId!));
      await expect(
        claimReferralCode(kit.as(n.actor), { code: bannedCode.code }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('BREAK: claims outside the window, or after a valid referral, are refused', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      const onTime = await newcomer('ontime');
      const n = await newcomer('latecomer');
      kit.clock.advance(30 * DAY); // boundary: exactly 30 days is still inside
      await expect(
        claimReferralCode(kit.as(onTime.actor), { code: code.code }),
      ).resolves.toBeTruthy();
      kit.clock.advance(1);
      await expect(claimReferralCode(kit.as(n.actor), { code: code.code })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      const m = await newcomer('counted');
      await kit.db.insert(referrals).values({
        inviteeUserId: m.user.id,
        method: 'unknown',
        status: 'valid',
        joinedAt: new Date(kit.clock.now().getTime() - 10 * DAY),
      });
      await expect(claimReferralCode(kit.as(m.actor), { code: code.code })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });

    it('BREAK: members JAVE never saw join cannot mint referrals by claiming codes', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      const veteran = await kit.member(); // synced, no observed join
      await expect(claimReferralCode(kit.as(veteran), { code: code.code })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      expect(await kit.db.select().from(referrals)).toHaveLength(0);
    });

    it('BREAK: a staff-invalidated join cannot be re-opened by claiming a code', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      const n = await newcomer('alt_account');
      const { referral } = await attributeJoin(kit.system, {
        inviteeUserId: n.user.id,
        usedCode: null,
        joinedAt: kit.clock.now(),
      });
      await kit.db
        .update(referrals)
        .set({ status: 'invalid', statusReason: 'staff_invalidated' })
        .where(eq(referrals.id, referral.id));
      await expect(claimReferralCode(kit.as(n.actor), { code: code.code })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      const rows = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.inviteeUserId, n.user.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('invalid');
    });

    it('BREAK: concurrent claims of different codes credit exactly one', async () => {
      const a = await kit.member();
      const b = await kit.member();
      const codeA = await createReferralCode(kit.as(a));
      const codeB = await createReferralCode(kit.as(b));
      const n = await newcomer('doubledip');
      const results = await Promise.allSettled([
        claimReferralCode(kit.as(n.actor), { code: codeA.code }),
        claimReferralCode(kit.as(n.actor), { code: codeB.code }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const rows = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.inviteeUserId, n.user.id));
      expect(rows).toHaveLength(1);
    });

    it('BREAK: claim attempts are rate-limited against code enumeration', async () => {
      const n = await newcomer('bruteforce');
      for (let i = 0; i < REFERRAL_CLAIM_RATE_LIMIT; i++) {
        await expect(
          claimReferralCode(kit.as(n.actor), { code: `GUESS${String(i).padStart(3, '0')}` }),
        ).rejects.toBeInstanceOf(NotFoundError);
      }
      await expect(claimReferralCode(kit.as(n.actor), { code: 'GUESS999' })).rejects.toBeInstanceOf(
        RateLimitedError,
      );
    });

    it('BREAK: malformed and huge codes are rejected before any lookup', async () => {
      const n = await newcomer('fuzzer');
      for (const code of ['', 'ab', 'x'.repeat(33), "' OR 1=1 --", '<img src=x>', '../../']) {
        await expect(claimReferralCode(kit.as(n.actor), { code })).rejects.toBeInstanceOf(
          ValidationError,
        );
      }
      await expect(
        claimReferralCode(kit.as(anonymousActor), { code: 'ABCD1234' }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it('BREAK: quarantined and banned accounts cannot credit anyone', async () => {
      const owner = await kit.member();
      const code = await createReferralCode(kit.as(owner));
      for (const standing of ['quarantined', 'banned'] as const) {
        const n = await newcomer(`held_${standing}`);
        await kit.db.update(members).set({ standing }).where(eq(members.id, n.member.id));
        const actor = await resolveUserActor(kit.system, n.user.id);
        await expect(claimReferralCode(kit.as(actor), { code: code.code })).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      }
      expect(await kit.db.select().from(referrals)).toHaveLength(0);
    });

    it('credits the code’s campaign when it accepts attributions', async () => {
      const owner = await kit.member();
      const c = await createCampaign(kit.as(core), { key: 'fall', name: 'Fall' });
      const code = await createReferralCode(kit.as(core), {
        campaignId: c.id,
        ownerMemberId: owner.memberId!,
      });
      const n = await newcomer('campaigner');
      await claimReferralCode(kit.as(n.actor), { code: code.code });
      const [row] = await kit.db
        .select()
        .from(referrals)
        .where(and(eq(referrals.inviteeUserId, n.user.id), eq(referrals.referralCode, code.code)));
      expect(row!.campaignId).toBe(c.id);
      const [codeRow] = await kit.db
        .select()
        .from(referralCodes)
        .where(eq(referralCodes.code, code.code));
      expect(codeRow!.active).toBe(true);
    });
  });
});
