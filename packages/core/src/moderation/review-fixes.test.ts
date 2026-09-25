import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull, like } from 'drizzle-orm';
import { jobs, modCases, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, NotFoundError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { applyAutomodDecision } from './automod.service';
import { executeCase } from './case-engine';
import { getCaseHistory, getCase, listCases } from './cases.query';
import {
  banMember,
  getCaseForSync,
  markCaseSynced,
  quarantineMember,
  releaseMember,
  timeoutMember,
  unbanMember,
  warnMember,
} from './cases.service';
import { DISCORD_MODERATION_APPLY_JOB, type ModerationApplyPayload } from './discord-jobs';
import { getSecurityEvent, listSecurityEvents } from './security.query';
import { recordSecurityEvent } from './security.service';
import { loadTarget } from './targets';
import {
  auditsOf,
  configureModeration,
  INTEGRATION_TIMEOUTS,
  MESSAGE_CHANNEL_ID,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

const DAY_SECONDS = 86_400;
let messageCounter = 700_000_000_000_000_000n;
const nextMessageId = () => (++messageCounter).toString();

describe('moderation review fixes', () => {
  let kit: TestKit;
  let founder: UserActor;
  let core: UserActor;
  let operations: UserActor;
  let moderator: UserActor;
  let peer: UserActor;
  let member: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    founder = await kit.member({ roles: ['founder'], username: 'founder' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    operations = await kit.member({ roles: ['operations'], username: 'ops' });
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    peer = await kit.member({ roles: ['moderator'], username: 'peer' });
    member = await kit.member({ roles: ['verified'], username: 'member' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const liveCase = async (userId: string, action: 'timeout' | 'quarantine' | 'ban') => {
    const [row] = await kit.db
      .select()
      .from(modCases)
      .where(
        and(
          eq(modCases.targetUserId, userId),
          eq(modCases.action, action),
          isNull(modCases.endedAt),
        ),
      );
    return row ?? null;
  };
  const applyPayloads = async () =>
    (await kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_MODERATION_APPLY_JOB))).map(
      (job) => ({
        status: job.status,
        dedupeKey: job.dedupeKey,
        payload: job.payload as ModerationApplyPayload,
      }),
    );

  describe('superseding follows the overturn rule', () => {
    it('BREAK: a moderator cannot shorten an operations timeout by issuing a new one', async () => {
      await timeoutMember(kit.as(operations), {
        targetUserId: member.userId,
        durationSeconds: 28 * DAY_SECONDS,
        reason: 'Serious harassment.',
      });
      await expect(
        timeoutMember(kit.as(moderator), {
          targetUserId: member.userId,
          durationSeconds: 60,
          reason: 'Lighter touch.',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const live = await liveCase(member.userId, 'timeout');
      expect(live?.moderatorUserId).toBe(operations.userId);
      expect(live?.durationSeconds).toBe(28 * DAY_SECONDS);
      expect(await auditsOf(kit, 'access.denied')).not.toHaveLength(0);
    });

    it('BREAK: core cannot end a founder quarantine by banning and then unbanning', async () => {
      await quarantineMember(kit.as(founder), {
        targetUserId: member.userId,
        reason: 'Investigation.',
      });
      await expect(
        banMember(kit.as(core), { targetUserId: member.userId, reason: 'Escalate.' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await liveCase(member.userId, 'quarantine')).not.toBeNull();
      expect(await liveCase(member.userId, 'ban')).toBeNull();
      await expect(
        releaseMember(kit.as(core), { targetUserId: member.userId, reason: 'Done.' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('the engine re-checks under the lock, even when a caller skips the pre-check', async () => {
      await timeoutMember(kit.as(operations), {
        targetUserId: member.userId,
        durationSeconds: DAY_SECONDS,
        reason: 'Operations decision.',
      });
      const target = await loadTarget(kit.system, { userId: member.userId });
      await expect(
        executeCase(kit.as(moderator), {
          action: 'timeout',
          target,
          reason: 'Bypass attempt.',
          source: 'manual',
          durationSeconds: 60,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('equal-ranked staff may replace each other’s timeouts; higher rank may replace lower', async () => {
      await timeoutMember(kit.as(peer), {
        targetUserId: member.userId,
        durationSeconds: 3600,
        reason: 'First.',
      });
      await timeoutMember(kit.as(moderator), {
        targetUserId: member.userId,
        durationSeconds: 600,
        reason: 'Adjusted.',
      });
      await timeoutMember(kit.as(core), {
        targetUserId: member.userId,
        durationSeconds: 7200,
        reason: 'Escalated.',
      });
      expect((await liveCase(member.userId, 'timeout'))?.moderatorUserId).toBe(core.userId);
    });
  });

  describe('quarantine without a quarantine role', () => {
    it('falls back to a capped Discord timeout, and release lifts it', async () => {
      await configureModeration(kit, { quarantineRole: false });
      const { updateSettings } = await import('../settings/settings.service');
      await updateSettings(kit.system, 'roles', { quarantineRoleId: undefined });
      const quarantined = await quarantineMember(kit.as(core), {
        targetUserId: member.userId,
        reason: 'Suspicious activity.',
      });
      expect(quarantined.discordSync).toBe('pending');
      const [apply] = await applyPayloads();
      expect(apply?.payload).toMatchObject({ action: 'quarantine', quarantineFallback: 'timeout' });
      expect(apply?.payload.quarantineRoleId).toBeUndefined();
      const until = new Date(apply!.payload.timeoutUntil!).getTime();
      expect(until - kit.clock.now().getTime()).toBeLessThanOrEqual(28 * DAY_SECONDS * 1000);

      await releaseMember(kit.as(core), { targetUserId: member.userId, reason: 'Cleared.' });
      const release = (await applyPayloads()).find((j) => j.payload.action === 'release');
      expect(release?.payload).toMatchObject({ quarantineFallback: 'timeout' });
    });

    it('automod escalates to a timeout when an earlier quarantine never took effect', async () => {
      const quarantined = await quarantineMember(kit.as(core), {
        targetUserId: member.userId,
        reason: 'Suspicious.',
      });
      await markCaseSynced(kit.system, {
        caseId: quarantined.id,
        status: 'failed',
        error: 'Missing Permissions',
      });
      const author = await loadTarget(kit.system, { userId: member.userId });
      const outcome = await applyAutomodDecision(kit.system, {
        discordUser: { discordId: author.discordId, username: author.username },
        evaluation: {
          signals: [{ key: 'spam_rate', weight: 99 }],
          riskScore: 99,
          action: 'quarantine',
          trigger: 'spam_rate',
        },
        channelId: MESSAGE_CHANNEL_ID,
        messageIds: [nextMessageId()],
      });
      expect(outcome.applied).toBe('timeout');
      expect(await liveCase(member.userId, 'timeout')).not.toBeNull();
    });
  });

  describe('Discord sync integrity', () => {
    it('ending a case cancels its queued apply job, and the bot pre-check refuses it', async () => {
      const ban = await banMember(kit.as(core), { targetUserId: member.userId, reason: 'Raid.' });
      await unbanMember(kit.as(core), { targetUserId: member.userId, reason: 'Appeal granted.' });
      const banJob = (await applyPayloads()).find((j) => j.payload.caseId === ban.id);
      expect(banJob?.status).toBe('cancelled');
      expect(await getCaseForSync(kit.system, ban.id)).toMatchObject({
        apply: false,
        reason: 'ended',
      });
      await expect(getCaseForSync(kit.as(core), ban.id)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('a late apply on an ended case re-sends the reversal so Discord converges', async () => {
      const ban = await banMember(kit.as(core), { targetUserId: member.userId, reason: 'Raid.' });
      const unban = await unbanMember(kit.as(core), {
        targetUserId: member.userId,
        reason: 'Appeal.',
      });
      await markCaseSynced(kit.system, { caseId: unban.id, status: 'applied' });
      // The ban job was mid-flight when the unban ran; it reports success afterwards.
      await markCaseSynced(kit.system, { caseId: ban.id, status: 'applied' });
      const heal = (await applyPayloads()).find((j) => j.dedupeKey?.includes(':heal:'));
      expect(heal?.payload).toMatchObject({ caseId: unban.id, action: 'unban' });
      expect(await auditsOf(kit, 'moderation.case_applied_after_end')).toHaveLength(1);
    });

    it('automated sync failures send one alert per cause per hour, not one per case', async () => {
      const cases = [];
      for (let i = 0; i < 4; i++) {
        const raider = await kit.member({ username: `raider${i}` });
        const target = await loadTarget(kit.system, { userId: raider.userId });
        cases.push(
          await executeCase(kit.system, {
            action: 'timeout',
            target,
            reason: 'Automod.',
            source: 'automod',
            durationSeconds: 600,
          }),
        );
      }
      for (const record of cases) {
        await markCaseSynced(kit.system, {
          caseId: record.id,
          status: 'failed',
          error: 'Missing Permissions',
        });
      }
      const alerts = await kit.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, moderator.userId),
            like(notifications.dedupeKey, 'mod-sync-failed:%'),
          ),
        );
      expect(alerts).toHaveLength(1);
    });
  });

  describe('BREAK: staff cannot read investigations into themselves or their superiors', () => {
    it('hides security events and reporter identity from the subject', async () => {
      await recordSecurityEvent(kit.as(moderator), {
        targetUserId: peer.userId,
        trigger: 'manual_report',
        riskScore: 40,
        excerpt: 'peer is abusing powers',
      });
      const own = await listSecurityEvents(kit.as(peer), { userId: peer.userId });
      expect(own.total).toBe(0);
      const all = await listSecurityEvents(kit.as(peer));
      expect(all.items.every((e) => e.user?.userId !== peer.userId)).toBe(true);
      const [event] = (await listSecurityEvents(kit.as(core), { userId: peer.userId })).items;
      expect(event?.reportedBy?.userId).toBe(moderator.userId);
      await expect(getSecurityEvent(kit.as(peer), event!.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('hides cases about yourself and about higher-ranked staff', async () => {
      const aboutModerator = await warnMember(kit.as(core), {
        targetUserId: moderator.userId,
        reason: 'Conduct review.',
      });
      await warnMember(kit.as(founder), { targetUserId: operations.userId, reason: 'Private.' });
      await warnMember(kit.as(moderator), { targetUserId: member.userId, reason: 'Spam.' });

      await expect(getCase(kit.as(moderator), aboutModerator.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        getCaseHistory(kit.as(moderator), { targetUserId: moderator.userId }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        getCaseHistory(kit.as(moderator), { targetUserId: operations.userId }),
      ).rejects.toBeInstanceOf(NotFoundError);
      const visible = await listCases(kit.as(moderator));
      expect(visible.items.map((c) => c.target.userId)).toEqual([member.userId]);

      const founderView = await listCases(kit.as(founder));
      expect(founderView.total).toBe(3);
      expect((await getCase(kit.as(core), aboutModerator.id)).id).toBe(aboutModerator.id);
    });
  });
});
