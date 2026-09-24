import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  guildMemberEvents,
  members,
  notifications,
  referrals,
} from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY, HOUR, MINUTE } from '../kernel/clock';
import { ForbiddenError, InvalidStateError, ValidationError } from '../kernel/errors';
import { createEventHandlers } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { completeOnboarding } from '../identity/profile.service';
import { recordGuildLeave, resolveUserActor } from '../identity/users.service';
import { updateSettings } from '../settings/settings.service';
import type { UserActor } from '../permissions/actor';
import { attributeJoin } from './attribution.service';
import { canTransition, REFERRAL_TRANSITIONS } from './lifecycle';
import { markInviteeLeft, runReferralSweep } from './lifecycle.service';
import { reviewReferral } from './review.service';
import { syncInvites } from './sync.service';
import { joinGuild, SLOW_DATABASE_TIMEOUTS } from './test-support';
import { jobHandlers, recurringJobs, REFERRAL_SWEEP_JOB, subscribers } from './index';

vi.setConfig(SLOW_DATABASE_TIMEOUTS);

describe('referral state machine', () => {
  it('LEFT and INVALID are terminal; VALID can only be invalidated', () => {
    expect(REFERRAL_TRANSITIONS.left).toEqual([]);
    expect(REFERRAL_TRANSITIONS.invalid).toEqual([]);
    expect(canTransition('valid', 'invalid')).toBe(true);
    expect(canTransition('valid', 'left')).toBe(false);
    expect(canTransition('joined', 'valid')).toBe(false);
    expect(canTransition('retained', 'valid')).toBe(true);
  });
});

describe('invites: referral lifecycle', () => {
  let kit: TestKit;
  let inviter: Awaited<ReturnType<typeof joinGuild>>;
  let core: UserActor;
  const eventHandlers = () => ({ ...jobHandlers, ...createEventHandlers(subscribers) });

  beforeEach(async () => {
    kit = await createTestKit();
    core = await kit.member({ roles: ['core'] });
    inviter = await joinGuild(kit, { username: 'inviter' });
    await syncInvites(kit.system, [
      { code: 'inv-main', inviterDiscordId: inviter.user.discordId, uses: 0 },
    ]);
  });
  afterEach(async () => {
    await kit.close();
  });

  async function refer(username: string, extra: { accountCreatedAt?: Date } = {}) {
    const joined = await joinGuild(kit, { username, ...extra });
    const { referral } = await attributeJoin(kit.system, {
      inviteeUserId: joined.user.id,
      usedCode: 'inv-main',
      joinedAt: kit.clock.now(),
    });
    return { ...joined, referral };
  }

  async function sweep() {
    await enqueueJob(kit.system, REFERRAL_SWEEP_JOB);
    const outcomes = await kit.drain(jobHandlers);
    const run = outcomes.find((o) => o.type === REFERRAL_SWEEP_JOB);
    expect(run?.status).toBe('completed');
    return run!.result!;
  }

  async function onboard(userId: string) {
    const actor = await resolveUserActor(kit.system, userId);
    await completeOnboarding(kit.as(actor), { displayName: 'Onboarded', primaryDomain: 'create' });
  }

  async function status(referralId: string) {
    const [row] = await kit.db.select().from(referrals).where(eq(referrals.id, referralId));
    return row!;
  }

  it('registers the sweep as hourly recurring work', () => {
    expect(recurringJobs).toEqual([{ type: REFERRAL_SWEEP_JOB, everyMs: HOUR }]);
    expect(Object.keys(jobHandlers)).toContain(REFERRAL_SWEEP_JOB);
  });

  describe('member.left', () => {
    it('marks the referral LEFT and flags a fast leave inside 24h', async () => {
      const r = await refer('quick');
      kit.clock.advance(3 * HOUR);
      await recordGuildLeave(kit.system, r.user.discordId);
      await kit.drain(eventHandlers());
      const row = await status(r.referral.id);
      expect(row).toMatchObject({ status: 'left', statusReason: 'left_guild' });
      expect(row.anomalyFlags).toContain('fast_leave');
      expect(row.leftAt?.toISOString()).toBe(kit.clock.now().toISOString());
    });

    it('boundary: leaving after exactly 24h is not a fast leave; redelivery is a no-op', async () => {
      const r = await refer('stayer');
      kit.clock.advance(DAY);
      await recordGuildLeave(kit.system, r.user.discordId);
      await kit.drain(eventHandlers());
      const row = await status(r.referral.id);
      expect(row.status).toBe('left');
      expect(row.anomalyFlags).not.toContain('fast_leave');
      const [event] = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'member.left'));
      expect(await markInviteeLeft(kit.system, event!.aggregateId, event!.occurredAt)).toBe(0);
    });

    it('BREAK: a delayed leave event never closes the referral of a later rejoin', async () => {
      const r = await refer('bouncer');
      kit.clock.advance(2 * DAY);
      await recordGuildLeave(kit.system, r.user.discordId); // event queued, not yet delivered
      kit.clock.advance(HOUR);
      await joinGuild(kit, { username: 'bouncer', discordId: r.user.discordId });
      const again = await attributeJoin(kit.system, {
        inviteeUserId: r.user.id,
        usedCode: 'inv-main',
        joinedAt: kit.clock.now(),
      });
      await kit.drain(eventHandlers()); // the stale member.left arrives now
      expect((await status(again.referral.id)).status).toBe('joined');
      expect((await status(r.referral.id)).status).toBe('left');
    });

    it('BREAK: a raid-speed leave recorded before Discord’s join timestamp still closes it', async () => {
      const joined = await joinGuild(kit, { username: 'raider' });
      // Discord's join timestamp runs 30 s ahead of our clock (allowed skew).
      const { referral } = await attributeJoin(kit.system, {
        inviteeUserId: joined.user.id,
        usedCode: 'inv-main',
        joinedAt: new Date(kit.clock.now().getTime() + 30_000),
      });
      await recordGuildLeave(kit.system, joined.user.discordId);
      await kit.drain(eventHandlers());
      const row = await status(referral.id);
      expect(row.status).toBe('left');
      expect(row.anomalyFlags).toContain('fast_leave');
      expect(row.leftAt!.getTime()).toBe(row.joinedAt.getTime()); // never before the join
    });

    it('BREAK: a malformed member.left aggregate is ignored, not retried forever', async () => {
      expect(
        await markInviteeLeft(kit.system, "1'; drop table referrals;--", kit.clock.now()),
      ).toBe(0);
    });

    it('a VALID referral stays valid and records leftAt', async () => {
      const r = await refer('keeper');
      await onboard(r.user.id);
      kit.clock.advance(8 * DAY);
      await sweep();
      expect((await status(r.referral.id)).status).toBe('valid');
      kit.clock.advance(30 * DAY);
      await recordGuildLeave(kit.system, r.user.discordId);
      await kit.drain(eventHandlers());
      const row = await status(r.referral.id);
      expect(row.status).toBe('valid');
      expect(row.leftAt).not.toBeNull();
    });
  });

  describe('hourly sweep', () => {
    it('JOINED → RETAINED exactly at retentionDays, not a minute before', async () => {
      const r = await refer('patient');
      kit.clock.advance(7 * DAY - MINUTE);
      expect((await sweep()).retained).toBe(0);
      expect((await status(r.referral.id)).status).toBe('joined');
      kit.clock.advance(MINUTE);
      expect((await sweep()).retained).toBe(1);
      const row = await status(r.referral.id);
      expect(row.status).toBe('retained');
      expect(row.retainedAt?.toISOString()).toBe(kit.clock.now().toISOString());
    });

    it('RETAINED → VALID requires onboarding; emits event + one notification; idempotent', async () => {
      const r = await refer('builder');
      kit.clock.advance(8 * DAY);
      const first = await sweep();
      expect(first).toMatchObject({ retained: 1, validated: 0 });
      await onboard(r.user.id);
      kit.clock.advance(HOUR);
      expect((await sweep()).validated).toBe(1);
      expect((await sweep()).validated).toBe(0);
      const row = await status(r.referral.id);
      expect(row.status).toBe('valid');
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'referral.validated'));
      expect(events).toHaveLength(1);
      expect(events[0]!.subjectMemberId).toBe(inviter.member.id);
      const notes = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, inviter.user.id));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ type: 'referral.validated', title: 'REFERRAL VALIDATED' });
      expect(notes[0]!.body).toBe('Onboarded is now a valid referral. Valid referrals: 1.');
    });

    it('validates without onboarding when the setting says so, and honours retentionDays', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await updateSettings(kit.as(founder), 'analytics', {
        validRequiresOnboarding: false,
        retentionDays: 2,
      });
      const r = await refer('quickvalid');
      kit.clock.advance(2 * DAY);
      expect(await sweep()).toMatchObject({ retained: 1, validated: 1 });
      expect((await status(r.referral.id)).status).toBe('valid');
    });

    it('hides a staff-only invitee’s name in the inviter notification', async () => {
      const r = await refer('shy');
      await onboard(r.user.id);
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, r.member.id));
      kit.clock.advance(8 * DAY);
      await sweep();
      const [note] = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, inviter.user.id));
      expect(note!.body).toBe('A member you referred is now a valid referral. Valid referrals: 1.');
    });

    it('anomalies at the threshold block VALID until staff clear them', async () => {
      const farm: Awaited<ReturnType<typeof refer>>[] = [];
      for (let i = 1; i <= 5; i++) {
        kit.clock.advance(5 * MINUTE);
        farm.push(
          await refer(`farm_acct_${i}`, {
            accountCreatedAt: new Date(kit.clock.now().getTime() - HOUR),
          }),
        );
      }
      for (const f of farm) await onboard(f.user.id);
      kit.clock.advance(8 * DAY);
      const result = await sweep();
      expect(result).toMatchObject({ retained: 5, validated: 0, blocked: 5 });
      const target = farm[0]!;
      const rescored = await status(target.referral.id);
      expect(rescored.anomalyFlags).toContain('join_burst'); // the first join is re-scored with the full cohort
      await reviewReferral(kit.as(core), {
        referralId: target.referral.id,
        decision: 'clear_flags',
        note: 'Verified in person at the meetup.',
      });
      kit.clock.advance(HOUR);
      expect((await sweep()).validated).toBe(1);
      const cleared = await status(target.referral.id);
      expect(cleared).toMatchObject({ status: 'valid', anomalyFlags: [], anomalyScore: 0 });
    });

    it('closes referrals whose leave was never delivered', async () => {
      const r = await refer('ghost');
      kit.clock.advance(2 * HOUR);
      await kit.db
        .insert(guildMemberEvents)
        .values({ userId: r.user.id, type: 'leave', occurredAt: kit.clock.now() });
      kit.clock.advance(8 * DAY);
      const result = await sweep();
      expect(result).toMatchObject({ left: 1, retained: 0 });
      const row = await status(r.referral.id);
      expect(row.status).toBe('left');
      expect(row.anomalyFlags).toContain('fast_leave');
    });

    it('closes referrals of members who departed without any recorded event', async () => {
      const r = await refer('vanished');
      const departedAt = new Date(kit.clock.now().getTime() + 3 * DAY);
      await kit.db
        .update(members)
        .set({ guildStatus: 'departed', leftGuildAt: departedAt })
        .where(eq(members.id, r.member.id));
      kit.clock.advance(8 * DAY);
      expect(await sweep()).toMatchObject({ left: 1, retained: 0 });
      const row = await status(r.referral.id);
      expect(row).toMatchObject({ status: 'left' });
      expect(row.leftAt?.toISOString()).toBe(departedAt.toISOString());
      expect(row.anomalyFlags).not.toContain('fast_leave');
    });

    it('does not retain quarantined members', async () => {
      const r = await refer('suspect');
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, r.member.id));
      kit.clock.advance(8 * DAY);
      expect((await sweep()).retained).toBe(0);
    });

    it('a person counts as VALID once: a later referral of them becomes invalid', async () => {
      const r = await refer('twice');
      await kit.db.insert(referrals).values({
        inviteeUserId: r.user.id,
        method: 'unknown',
        status: 'valid',
        joinedAt: new Date(kit.clock.now().getTime() - 400 * DAY),
        validatedAt: new Date(kit.clock.now().getTime() - 390 * DAY),
      });
      await onboard(r.user.id);
      kit.clock.advance(8 * DAY);
      const result = await sweep();
      expect(result.duplicates).toBe(1);
      expect(await status(r.referral.id)).toMatchObject({
        status: 'invalid',
        statusReason: 'duplicate_invitee',
      });
    });

    it('BREAK: users cannot trigger the sweep directly', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await expect(runReferralSweep(kit.as(founder))).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('staff review', () => {
    it('invalidation removes a VALID referral from counts with audit and event', async () => {
      const r = await refer('invalidateme');
      await onboard(r.user.id);
      kit.clock.advance(8 * DAY);
      await sweep();
      const row = await reviewReferral(kit.as(core), {
        referralId: r.referral.id,
        decision: 'invalidate',
        note: 'Alt account of an existing member.',
      });
      expect(row).toMatchObject({ status: 'invalid', statusReason: 'staff_invalidated' });
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'referral.invalidated'));
      expect(audit[0]!.context).toMatchObject({ previousStatus: 'valid' });
      const events = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'referral.invalidated'));
      expect(events[0]!.subjectMemberId).toBe(inviter.member.id);
    });

    it('BREAK: an inviter cannot review their own referral — not even a founder', async () => {
      const founder = await kit.member({ roles: ['founder'] });
      await syncInvites(kit.system, [
        { code: 'inv-main', inviterDiscordId: inviter.user.discordId, uses: 0 },
        { code: 'founder1', inviterDiscordId: founder.discordId, uses: 0 },
      ]);
      const joined = await joinGuild(kit, { username: 'friend' });
      const { referral } = await attributeJoin(kit.system, {
        inviteeUserId: joined.user.id,
        usedCode: 'founder1',
        joinedAt: kit.clock.now(),
      });
      await expect(
        reviewReferral(kit.as(founder), {
          referralId: referral.id,
          decision: 'clear_flags',
          note: 'Looks fine to me.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const blocked = await kit.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'referral.self_review_blocked'),
            eq(auditLogs.actorUserId, founder.userId),
          ),
        );
      expect(blocked).toHaveLength(1);
    });

    it('BREAK: reviewers need canManageCampaigns; closed referrals cannot be reviewed', async () => {
      const ops = await kit.member({ roles: ['operations'] });
      const r = await refer('closed');
      await expect(
        reviewReferral(kit.as(ops), {
          referralId: r.referral.id,
          decision: 'invalidate',
          note: 'No authority.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await recordGuildLeave(kit.system, r.user.discordId);
      await kit.drain(eventHandlers());
      for (const decision of ['clear_flags', 'invalidate'] as const) {
        await expect(
          reviewReferral(kit.as(core), { referralId: r.referral.id, decision, note: 'Too late.' }),
        ).rejects.toBeInstanceOf(InvalidStateError);
      }
      await expect(
        reviewReferral(kit.as(core), {
          referralId: r.referral.id,
          decision: 'clear_flags',
          note: 'x',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        reviewReferral(kit.as(core), {
          referralId: r.referral.id,
          decision: 'approve' as 'invalidate',
          note: 'Unknown decision.',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
