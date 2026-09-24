import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { inviteCodes, members, referrals, users } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR } from '../kernel/clock';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { resolveUserActor } from '../identity/users.service';
import { attributeJoin } from './attribution.service';
import { attachInviteToCampaign, createCampaign } from './campaigns.service';
import { claimReferralCode, createReferralCode } from './referral-codes.service';
import {
  getMyReferrals,
  getReferralFunnel,
  getReferralLeaderboard,
  listInviterFunnels,
  listReferrals,
} from './stats.service';
import { syncInvites } from './sync.service';
import { joinGuild, SLOW_DATABASE_TIMEOUTS } from './test-support';

type Status = 'joined' | 'retained' | 'valid' | 'left' | 'invalid';

const FIXTURE_JOIN_SPACING_MS = 2 * HOUR;

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('invites: leaderboard, funnels and member view', () => {
  let kit: TestKit;
  let core: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  async function inviterWithInvite(username: string, code: string, uses = 0) {
    const joined = await joinGuild(kit, { username });
    await syncInvites(kit.system, [
      ...(await currentInvites()),
      { code, inviterDiscordId: joined.user.discordId, uses },
    ]);
    return { ...joined, actor: await resolveUserActor(kit.system, joined.user.id), code };
  }

  async function currentInvites() {
    const rows = await kit.db
      .select({ code: inviteCodes.code, uses: inviteCodes.uses, discordId: users.discordId })
      .from(inviteCodes)
      .leftJoin(users, eq(users.id, inviteCodes.inviterUserId));
    return rows.map((r) => ({ code: r.code, uses: r.uses, inviterDiscordId: r.discordId }));
  }

  /** Attribute a join then force the referral into a lifecycle state (fixture shortcut). */
  async function referral(
    code: string,
    username: string,
    state: { status: Status; flags?: string[]; validatedDaysAgo?: number } = { status: 'joined' },
  ) {
    // Space joins out so fixtures do not trip the join-burst detector.
    kit.clock.advance(FIXTURE_JOIN_SPACING_MS);
    const joined = await joinGuild(kit, { username });
    const { referral: row } = await attributeJoin(kit.system, {
      inviteeUserId: joined.user.id,
      usedCode: code,
      joinedAt: kit.clock.now(),
    });
    const now = kit.clock.now().getTime();
    const validatedAt =
      state.status === 'valid' ? new Date(now - (state.validatedDaysAgo ?? 1) * DAY) : null;
    await kit.db
      .update(referrals)
      .set({
        status: state.status,
        retainedAt: ['retained', 'valid'].includes(state.status) ? new Date(now - 2 * DAY) : null,
        validatedAt,
        anomalyFlags: state.flags ?? [],
        anomalyScore: state.flags?.length ? 30 : 0,
      })
      .where(eq(referrals.id, row.id));
    return { ...joined, referralId: row.id };
  }

  describe('leaderboard', () => {
    it('ranks by VALID, unflagged referrals; excludes opted-out, private and bad-standing inviters', async () => {
      const ada = await inviterWithInvite('ada', 'ada-inv');
      const bob = await inviterWithInvite('bob', 'bob-inv');
      const cy = await inviterWithInvite('cy', 'cy-inv');
      const hidden = await inviterWithInvite('hidden', 'hid-inv');
      const banned = await inviterWithInvite('banned', 'ban-inv');
      const privateProfile = await inviterWithInvite('private', 'prv-inv');
      for (let i = 0; i < 3; i++) await referral('ada-inv', `ada_friend_${i}`, { status: 'valid' });
      await referral('ada-inv', 'ada_pending', { status: 'retained' });
      await referral('ada-inv', 'ada_left', { status: 'left' });
      for (let i = 0; i < 2; i++) await referral('bob-inv', `bob_friend_${i}`, { status: 'valid' });
      for (let i = 0; i < 4; i++) {
        await referral('bob-inv', `bob_farm_${i}`, { status: 'valid', flags: ['join_burst'] });
      }
      await referral('cy-inv', 'cy_friend', { status: 'valid' });
      await referral('hid-inv', 'hid_friend_1', { status: 'valid' });
      await referral('hid-inv', 'hid_friend_2', { status: 'valid' });
      await referral('ban-inv', 'ban_friend', { status: 'valid' });
      for (let i = 0; i < 5; i++) await referral('prv-inv', `prv_friend_${i}`, { status: 'valid' });
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, privateProfile.member.id));
      await kit.db
        .update(members)
        .set({ showOnLeaderboards: false })
        .where(eq(members.id, hidden.member.id));
      await kit.db
        .update(members)
        .set({ standing: 'banned' })
        .where(eq(members.id, banned.member.id));

      const viewer = await kit.member();
      const board = await getReferralLeaderboard(kit.as(viewer));
      expect(board.map((e) => [e.handle, e.validReferrals, e.rank])).toEqual([
        [ada.member.handle, 3, 1],
        [bob.member.handle, 2, 2],
        [cy.member.handle, 1, 3],
      ]);
    });

    it('filters by campaign and period; ties share a rank', async () => {
      await inviterWithInvite('ada', 'ada-inv');
      await inviterWithInvite('bob', 'bob-inv');
      const c = await createCampaign(kit.as(core), { key: 'summer', name: 'Summer' });
      await attachInviteToCampaign(kit.as(core), { code: 'bob-inv', campaignId: c.id });
      await referral('ada-inv', 'old_friend', { status: 'valid', validatedDaysAgo: 40 });
      await referral('ada-inv', 'new_friend', { status: 'valid', validatedDaysAgo: 3 });
      await referral('bob-inv', 'summer_friend', { status: 'valid', validatedDaysAgo: 2 });
      const viewer = await kit.member();
      const recent = await getReferralLeaderboard(kit.as(viewer), { periodDays: 30 });
      expect(recent.map((e) => [e.validReferrals, e.rank])).toEqual([
        [1, 1],
        [1, 1],
      ]);
      const summer = await getReferralLeaderboard(kit.as(viewer), { campaignId: c.id });
      expect(summer).toHaveLength(1);
      expect(summer[0]!.validReferrals).toBe(1);
    });

    it('BREAK: anonymous viewers and malformed filters are refused', async () => {
      await expect(getReferralLeaderboard(kit.as(anonymousActor))).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      const viewer = await kit.member();
      await expect(
        getReferralLeaderboard(kit.as(viewer), { periodDays: 8 as 7 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        getReferralLeaderboard(kit.as(viewer), { limit: 10_000 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('funnels', () => {
    it('computes INVITED → JOINED → RETAINED → VALID per inviter and per campaign', async () => {
      const ada = await inviterWithInvite('ada', 'ada-inv', 9);
      const c = await createCampaign(kit.as(core), { key: 'fair', name: 'Science fair' });
      await attachInviteToCampaign(kit.as(core), { code: 'ada-inv', campaignId: c.id });
      await referral('ada-inv', 'f1', { status: 'valid' });
      await referral('ada-inv', 'f2', { status: 'valid', flags: ['new_account'] });
      await referral('ada-inv', 'f3', { status: 'retained' });
      await referral('ada-inv', 'f4', { status: 'left', flags: ['fast_leave'] });
      await referral('ada-inv', 'f5', { status: 'joined' });
      const code = await createReferralCode(kit.as(ada.actor));
      const claimer = await joinGuild(kit, { username: 'coded' });
      await claimReferralCode(kit.as(await resolveUserActor(kit.system, claimer.user.id)), {
        code: code.code,
      });

      const funnel = await getReferralFunnel(kit.as(core), { inviterMemberId: ada.member.id });
      expect(funnel).toMatchObject({
        inviteUses: 9,
        codeClaims: 1,
        invited: 10,
        joined: 6,
        retained: 3,
        valid: 2,
        left: 1,
        flagged: 2,
        fastLeaves: 1,
        retentionRate: 0.5,
        validRate: 0.3333,
      });
      const campaignFunnel = await getReferralFunnel(kit.as(core), { campaignId: c.id });
      expect(campaignFunnel).toMatchObject({ inviteUses: 9, joined: 5, valid: 2 });
      const global = await getReferralFunnel(kit.as(core));
      expect(global.joined).toBe(6);

      const page = await listInviterFunnels(kit.as(core));
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({ memberId: ada.member.id });
      expect(page.items[0]!.funnel.valid).toBe(2);
    });

    it('members read their own funnel; BREAK: not someone else’s (IDOR)', async () => {
      const ada = await inviterWithInvite('ada', 'ada-inv');
      const eve = await kit.member();
      await expect(
        getReferralFunnel(kit.as(ada.actor), { inviterMemberId: ada.member.id }),
      ).resolves.toMatchObject({ joined: 0 });
      await expect(
        getReferralFunnel(kit.as(eve), { inviterMemberId: ada.member.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getReferralFunnel(kit.as(eve))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listInviterFunnels(kit.as(eve))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listReferrals(kit.as(eve))).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('my referrals', () => {
    it('shows codes, funnel and referrals without leaking flag details or private names', async () => {
      const ada = await inviterWithInvite('ada', 'ada-inv');
      await createReferralCode(kit.as(ada.actor));
      const open = await referral('ada-inv', 'visible_friend', { status: 'valid' });
      const shy = await referral('ada-inv', 'shy_friend', {
        status: 'retained',
        flags: ['similar_usernames'],
      });
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, shy.member.id));

      const view = await getMyReferrals(kit.as(ada.actor));
      expect(view.codes).toHaveLength(1);
      expect(view.codes[0]!.claims).toBe(0);
      expect(view.funnel.joined).toBe(2);
      const byId = new Map(view.referrals.map((r) => [r.id, r]));
      expect(byId.get(open.referralId)).toMatchObject({
        inviteeName: 'visible_friend',
        underReview: false,
      });
      expect(byId.get(shy.referralId)).toMatchObject({
        inviteeName: 'Private member',
        underReview: true,
      });
      expect(JSON.stringify(view)).not.toContain('similar_usernames');
      expect(view.usedCode).toBeNull();
    });

    it('staff listing exposes anomaly detail and filters the review queue', async () => {
      await inviterWithInvite('ada', 'ada-inv');
      await referral('ada-inv', 'clean', { status: 'retained' });
      await referral('ada-inv', 'dodgy', { status: 'retained', flags: ['join_burst'] });
      const queue = await listReferrals(kit.as(core), { flagged: true });
      expect(queue.total).toBe(1);
      expect(queue.items[0]).toMatchObject({ inviteeName: 'dodgy', anomalyFlags: ['join_burst'] });
      const clean = await listReferrals(kit.as(core), { flagged: false, status: 'retained' });
      expect(clean.items.map((i) => i.inviteeName)).toEqual(['clean']);
    });

    it('BREAK: anonymous and profile-less users cannot open a referral view', async () => {
      await expect(getMyReferrals(kit.as(anonymousActor))).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });
  });
});
