import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, domainEvents, referrals } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, MINUTE } from '../kernel/clock';
import { ConflictError, InvalidStateError, NotFoundError } from '../kernel/errors';
import { enqueueJob } from '../jobs/queue';
import { createEventHandlers } from '../events/bus';
import { completeOnboarding } from '../identity/profile.service';
import { recordGuildLeave, resolveUserActor } from '../identity/users.service';
import type { UserActor } from '../permissions/actor';
import { attributeJoin } from './attribution.service';
import {
  claimReferralCode,
  createReferralCode,
  deactivateReferralCode,
} from './referral-codes.service';
import { reviewReferral } from './review.service';
import { syncInvites } from './sync.service';
import { joinGuild, SLOW_DATABASE_TIMEOUTS } from './test-support';
import { jobHandlers, REFERRAL_SWEEP_JOB, subscribers } from './index';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

/**
 * Discord stamps a join before JAVE records it (gateway delivery plus the
 * invite fetch), or slightly after when Discord's clock runs ahead. These
 * offsets mirror that: attribution never shares JAVE's join timestamp.
 */
const DISCORD_BEHIND_MS = 1_500;
const DISCORD_AHEAD_MS = 1_500;

describe('invites: claim integrity', () => {
  let kit: TestKit;
  let core: UserActor;
  let colluder: UserActor;
  let colluderCode: string;

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
    colluder = await kit.member();
    colluderCode = (await createReferralCode(kit.as(colluder))).code;
  });
  afterEach(async () => {
    await kit.close();
  });

  async function newcomer(username: string) {
    const joined = await joinGuild(kit, { username });
    return { ...joined, actor: await resolveUserActor(kit.system, joined.user.id) };
  }

  /** The bot's attributeJoin with Discord's join timestamp, offset from JAVE's clock. */
  async function attributeWithDiscordTime(
    inviteeUserId: string,
    offsetMs: number,
    usedCode: string | null = null,
  ) {
    const { referral } = await attributeJoin(kit.system, {
      inviteeUserId,
      usedCode,
      joinedAt: new Date(kit.clock.now().getTime() + offsetMs),
    });
    return referral;
  }

  async function referralsOf(userId: string) {
    return kit.db.select().from(referrals).where(eq(referrals.inviteeUserId, userId));
  }

  async function onboardAndSweep(userId: string) {
    const actor = await resolveUserActor(kit.system, userId);
    await completeOnboarding(kit.as(actor), { displayName: 'Onboarded', primaryDomain: 'create' });
    kit.clock.advance(8 * DAY);
    await enqueueJob(kit.system, REFERRAL_SWEEP_JOB);
    const outcomes = await kit.drain(jobHandlers);
    return outcomes.find((o) => o.type === REFERRAL_SWEEP_JOB)!.result as {
      retained: number;
      validated: number;
    };
  }

  describe('a closed attribution of the current stay', () => {
    for (const [label, offset] of [
      ['behind', -DISCORD_BEHIND_MS],
      ['ahead of', DISCORD_AHEAD_MS],
    ] as const) {
      it(`BREAK: staff invalidation holds when Discord's timestamp runs ${label} ours`, async () => {
        const n = await newcomer('fraud_ring');
        const referral = await attributeWithDiscordTime(n.user.id, offset);
        await reviewReferral(kit.as(core), {
          referralId: referral.id,
          decision: 'invalidate',
          note: 'fraud ring',
        });
        await expect(
          claimReferralCode(kit.as(n.actor), { code: colluderCode }),
        ).rejects.toBeInstanceOf(InvalidStateError);
        const rows = await referralsOf(n.user.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'invalid', referralCode: null });
        expect(await onboardAndSweep(n.user.id)).toMatchObject({ retained: 0, validated: 0 });
        const validated = await kit.db
          .select()
          .from(domainEvents)
          .where(eq(domainEvents.type, 'referral.validated'));
        expect(validated).toHaveLength(0);
      });
    }

    it('BREAK: a self-invite join cannot be re-credited through a code', async () => {
      const n = await newcomer('self_inviter');
      await syncInvites(kit.system, [
        { code: 'own-link', inviterDiscordId: n.user.discordId, uses: 1 },
      ]);
      const referral = await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS, 'own-link');
      expect(referral.status).toBe('invalid');
      await expect(
        claimReferralCode(kit.as(n.actor), { code: colluderCode }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      expect(await referralsOf(n.user.id)).toHaveLength(1);
    });
  });

  describe('rejoins', () => {
    it('a later stay can claim a code and is flagged as a rejoin', async () => {
      const n = await newcomer('returner');
      const first = await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS);
      kit.clock.advance(2 * DAY);
      await recordGuildLeave(kit.system, n.user.discordId);
      kit.clock.advance(3 * DAY);
      await joinGuild(kit, { username: 'returner', discordId: n.user.discordId });
      const result = await claimReferralCode(kit.as(n.actor), { code: colluderCode });
      const [row] = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.id, result.referralId));
      expect(row!.id).not.toBe(first.id);
      expect(row!.anomalyFlags).toContain('rejoin');
    });

    it('BREAK: a rejoin within minutes is still a new stay, not the closed one', async () => {
      const n = await newcomer('bounce');
      await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS);
      kit.clock.advance(MINUTE);
      await recordGuildLeave(kit.system, n.user.discordId);
      kit.clock.advance(MINUTE);
      await joinGuild(kit, { username: 'bounce', discordId: n.user.discordId });
      const result = await claimReferralCode(kit.as(n.actor), { code: colluderCode });
      const [row] = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.id, result.referralId));
      expect(row!.anomalyFlags).toContain('rejoin');
    });

    for (const [label, offset] of [
      ['behind', -DISCORD_BEHIND_MS],
      ['ahead of', DISCORD_AHEAD_MS],
    ] as const) {
      it(`a late attribution of the same stay (Discord ${label} us) leaves the claim in place`, async () => {
        const n = await newcomer('patient_bot');
        kit.clock.advance(MINUTE);
        const claim = await claimReferralCode(kit.as(n.actor), { code: colluderCode });
        // The bot's attributeJoin for the very same join arrives after the claim.
        const late = await attributeJoin(kit.system, {
          inviteeUserId: n.user.id,
          usedCode: null,
          joinedAt: new Date(n.member.joinedGuildAt!.getTime() + offset),
        });
        expect(late.referral).toMatchObject({ status: 'left', statusReason: 'superseded' });
        expect(await onboardAndSweep(n.user.id)).toMatchObject({ validated: 1 });
        const [row] = await kit.db
          .select()
          .from(referrals)
          .where(eq(referrals.id, claim.referralId));
        expect(row).toMatchObject({ status: 'valid', inviterUserId: colluder.userId });
        expect(row!.anomalyFlags).not.toContain('rejoin');
      });
    }

    it('BREAK: a delayed leave after a quick rejoin closes the old stay, not the new one', async () => {
      const n = await newcomer('flicker');
      const first = await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS);
      kit.clock.advance(MINUTE);
      await recordGuildLeave(kit.system, n.user.discordId);
      kit.clock.advance(MINUTE);
      await joinGuild(kit, { username: 'flicker', discordId: n.user.discordId });
      // The member.left subscriber runs only now, after the rejoin was recorded.
      await kit.drain({ ...jobHandlers, ...createEventHandlers(subscribers) });
      const [old] = await kit.db.select().from(referrals).where(eq(referrals.id, first.id));
      expect(old!.status).toBe('left');
      const second = await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS);
      expect(second).toMatchObject({ status: 'joined' });
      expect(second.anomalyFlags).toContain('rejoin');
    });
  });

  it('BREAK: concurrent claims on a live referral credit exactly one code', async () => {
    const other = await kit.member();
    const otherCode = (await createReferralCode(kit.as(other))).code;
    const n = await newcomer('double_claim');
    const live = await attributeWithDiscordTime(n.user.id, -DISCORD_BEHIND_MS);
    const results = await Promise.allSettled([
      claimReferralCode(kit.as(n.actor), { code: colluderCode }),
      claimReferralCode(kit.as(n.actor), { code: otherCode }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    const rows = await referralsOf(n.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(live.id);
    const winner = fulfilled[0] as PromiseFulfilledResult<{ referralId: string }>;
    expect(winner.value.referralId).toBe(live.id);
    const winnerCode = rows[0]!.referralCode;
    expect([colluderCode, otherCode]).toContain(winnerCode);
    const claims = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'referral.code_claimed'));
    expect(claims).toHaveLength(1);
    const recorded = await kit.db
      .select()
      .from(domainEvents)
      .where(
        and(eq(domainEvents.type, 'referral.recorded'), eq(domainEvents.aggregateId, live.id)),
      );
    expect(recorded).toHaveLength(2); // attribution + the single winning claim
  });

  describe('deactivateReferralCode', () => {
    it('BREAK: non-owners without canManageCampaigns cannot tell real codes from unknown ones', async () => {
      const prober = await kit.member();
      const moderator = await kit.member({ roles: ['moderator'] });
      const auditBefore = (await kit.db.select().from(auditLogs)).length;
      for (const actor of [prober, moderator]) {
        const existing = await deactivateReferralCode(kit.as(actor), { code: colluderCode }).catch(
          (error: unknown) => error,
        );
        const unknown = await deactivateReferralCode(kit.as(actor), { code: 'ZZZZ9999' }).catch(
          (error: unknown) => error,
        );
        expect(existing).toBeInstanceOf(NotFoundError);
        expect(unknown).toBeInstanceOf(NotFoundError);
        expect((existing as Error).message).toBe((unknown as Error).message);
      }
      // Probes leave no durable trace an attacker could use to flood the audit log.
      expect(await kit.db.select().from(auditLogs)).toHaveLength(auditBefore);
      const [code] = await kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.referralCode, colluderCode));
      expect(code).toBeUndefined();
    });

    it('owners and campaign staff still deactivate', async () => {
      const own = await deactivateReferralCode(kit.as(colluder), { code: colluderCode });
      expect(own.active).toBe(false);
      const second = await createReferralCode(kit.as(colluder));
      const staff = await deactivateReferralCode(kit.as(core), { code: second.code });
      expect(staff.active).toBe(false);
      await expect(
        deactivateReferralCode(kit.as(core), { code: 'ZZZZ9999' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
