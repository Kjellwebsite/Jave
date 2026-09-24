import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { guildMemberEvents, jobs, members, modCases, securityEvents, users } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError } from '../kernel/errors';
import { recordGuildJoin, recordGuildLeave } from '../identity/users.service';
import type { UserActor } from '../permissions/actor';
import { getSettings, updateSettings } from '../settings/settings.service';
import { quarantineMember } from './cases.service';
import {
  DISCORD_MODERATION_APPLY_JOB,
  DISCORD_MODERATION_LOCKDOWN_JOB,
  moderationLockdownPayloadSchema,
} from './discord-jobs';
import { screenJoin, setRaidMode } from './raid.service';
import {
  INTEGRATION_TIMEOUTS,
  ALERT_CHANNEL_ID,
  auditsOf,
  configureModeration,
  eventsOf,
  jobsOfType,
  notificationsFor,
  snowflakeAt,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

const OLD_ACCOUNT = new Date('2020-01-01T00:00:00Z');

describe('raid mode and join screening', () => {
  let kit: TestKit;
  let core: UserActor;
  let moderator: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    core = await kit.member({ roles: ['core'], username: 'core' });
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const joiner = (username: string, created = OLD_ACCOUNT, avatarHash: string | null = 'abc') => ({
    discordId: snowflakeAt(created),
    username,
    avatarHash,
  });

  /** Simulate the bot: identity records the join, moderation screens it. */
  const join = async (profile: ReturnType<typeof joiner>) => {
    await recordGuildJoin(kit.system, profile);
    return screenJoin(kit.system, { discordUser: profile });
  };

  const standingOf = async (discordId: string) => {
    const [row] = await kit.db
      .select({ standing: members.standing })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(users.discordId, discordId));
    return row?.standing;
  };

  describe('setRaidMode', () => {
    it('switches raid mode (canManageSecurity), audits, alerts staff and queues lockdown', async () => {
      const result = await setRaidMode(kit.as(core), { enabled: true, reason: 'Invite leak.' });
      expect(result).toEqual({ raidMode: true, changed: true });
      expect((await getSettings(kit.system, 'security')).raidMode).toBe(true);
      const [audit] = await auditsOf(kit, 'security.raid_mode_changed');
      expect(audit).toMatchObject({ actorUserId: core.userId });
      expect(audit?.context).toMatchObject({ enabled: true, automatic: false });
      expect(await eventsOf(kit, 'security.raid_mode_changed')).toHaveLength(1);
      const [lockdown] = (await jobsOfType(kit, DISCORD_MODERATION_LOCKDOWN_JOB)).map((j) =>
        moderationLockdownPayloadSchema.parse(j.payload),
      );
      expect(lockdown).toMatchObject({ enabled: true, noticeChannelId: ALERT_CHANNEL_ID });
      const [alert] = await notificationsFor(kit, moderator.userId, 'security.alert');
      expect(alert).toMatchObject({ title: 'RAID MODE — ON', severity: 'critical' });
      expect(await notificationsFor(kit, core.userId, 'security.alert')).toHaveLength(0);

      expect(await setRaidMode(kit.as(core), { enabled: true, reason: 'Again.' })).toEqual({
        raidMode: true,
        changed: false,
      });
      expect(await setRaidMode(kit.as(core), { enabled: false, reason: 'Clear.' })).toEqual({
        raidMode: false,
        changed: true,
      });
    });

    it('BREAK: moderators cannot change raid mode', async () => {
      await expect(
        setRaidMode(kit.as(moderator), { enabled: true, reason: 'Panic.' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((await getSettings(kit.system, 'security')).raidMode).toBe(false);
    });
  });

  describe('screenJoin', () => {
    it('lets an ordinary join through', async () => {
      const result = await join(joiner('ada'));
      expect(result).toMatchObject({
        securityEventId: null,
        caseId: null,
        raidModeEnabled: false,
        reapplied: null,
      });
      expect(result.evaluation.suspicious).toBe(false);
    });

    it('records suspicious joins; holds them only when configured', async () => {
      const fresh = await join(joiner('newbie', kit.clock.now()));
      expect(fresh.evaluation.suspicious).toBe(true);
      expect(fresh.caseId).toBeNull();
      const [event] = await kit.db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.id, fresh.securityEventId!));
      expect(event).toMatchObject({
        trigger: 'suspicious_account',
        source: 'join_screening',
        actionTaken: 'flagged',
      });

      await updateSettings(kit.system, 'security', { quarantineSuspiciousJoins: true });
      const profile = joiner('newbie2', kit.clock.now());
      const held = await join(profile);
      expect(held.caseId).not.toBeNull();
      expect(await standingOf(profile.discordId)).toBe('quarantined');
    });

    it('detects a join burst, switches raid mode on once and holds new joins', async () => {
      const results = [];
      for (let i = 0; i < 12; i++) {
        results.push(await join(joiner(`raider${i}`)));
        kit.clock.advance(1000);
      }
      const enabled = results.filter((r) => r.raidModeEnabled);
      expect(enabled).toHaveLength(1);
      expect(results.findIndex((r) => r.raidModeEnabled)).toBe(9);
      expect((await getSettings(kit.system, 'security')).raidMode).toBe(true);

      const raidEvents = await kit.db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.trigger, 'join_burst'));
      expect(raidEvents).toHaveLength(1);
      expect(raidEvents[0]).toMatchObject({ actionTaken: 'lockdown', userId: null });
      const [audit] = await auditsOf(kit, 'security.raid_mode_changed');
      expect(audit?.context).toMatchObject({ enabled: true, automatic: true });
      const alerts = await notificationsFor(kit, moderator.userId, 'security.alert');
      expect(alerts.find((a) => a.title === 'RAID MODE — ON')?.severity).toBe('critical');

      // The triggering join and everything after it is held.
      expect(results.slice(9).every((r) => r.caseId !== null)).toBe(true);
      expect(results.slice(0, 9).every((r) => r.caseId === null)).toBe(true);
    });

    it('does not switch raid mode on when autoRaidMode is off', async () => {
      await updateSettings(kit.system, 'security', { autoRaidMode: false });
      let last;
      for (let i = 0; i < 10; i++) last = await join(joiner(`burst${i}`));
      expect(last?.evaluation.raidDetected).toBe(true);
      expect(last?.raidModeEnabled).toBe(false);
      expect(last?.caseId).toBeNull();
      expect((await getSettings(kit.system, 'security')).raidMode).toBe(false);
    });

    it('never holds staff, even in raid mode', async () => {
      await setRaidMode(kit.as(core), { enabled: true, reason: 'Drill.' });
      await recordGuildLeave(kit.system, moderator.discordId);
      const result = await join({
        discordId: moderator.discordId,
        username: 'mod',
        avatarHash: 'abc',
      });
      expect(result.caseId).toBeNull();
    });

    it('re-applies a live quarantine when the member rejoins', async () => {
      const target = await kit.member({ username: 'returning' });
      await quarantineMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Hold.' });
      await recordGuildLeave(kit.system, target.discordId);
      // The original Discord job ran while they were here.
      await kit.db.update(jobs).set({ status: 'completed' });
      await kit.db.update(modCases).set({ discordSync: 'applied' });

      const result = await join({
        discordId: target.discordId,
        username: 'returning',
        avatarHash: 'abc',
      });
      expect(result.reapplied).toBe('quarantine');
      expect(result.caseId).toBeNull();
      const [record] = await kit.db.select().from(modCases);
      expect(record?.discordSync).toBe('pending');
      const pending = (await jobsOfType(kit, DISCORD_MODERATION_APPLY_JOB)).filter(
        (job) => job.status === 'pending',
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]?.payload).toMatchObject({ action: 'quarantine', caseId: record?.id });
      expect(pending[0]?.payload).not.toHaveProperty('dmText');
      expect(await kit.db.select().from(modCases)).toHaveLength(1);
    });

    it('counts only joins inside the window (time edge)', async () => {
      const old = await kit.member({ username: 'old' });
      const window = (await getSettings(kit.system, 'security')).joinBurstWindowSeconds;
      const cutoff = new Date(kit.clock.now().getTime() - window * 1000);
      await kit.db.insert(guildMemberEvents).values(
        Array.from({ length: 20 }, () => ({
          userId: old.userId,
          type: 'join' as const,
          occurredAt: cutoff,
        })),
      );
      const result = await join(joiner('edge'));
      expect(result.evaluation.joinsInWindow).toBe(1);
      expect(result.evaluation.raidDetected).toBe(false);
    });

    it('BREAK: user actors cannot call the gateway entry point', async () => {
      await expect(
        screenJoin(kit.as(core), { discordUser: joiner('spoof') }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
