import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, modCases, notificationDeliveries, notifications } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR, MINUTE } from '../kernel/clock';
import { enqueueJob } from '../jobs/queue';
import { InvalidStateError, ConflictError, ValidationError } from '../kernel/errors';
import { recordGuildLeave, resolveUserActor } from '../identity/users.service';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import {
  addModNote,
  banMember,
  kickMember,
  markCaseSynced,
  quarantineMember,
  releaseMember,
  revokeCase,
  timeoutMember,
  unbanMember,
  untimeoutMember,
  warnMember,
} from './cases.service';
import { getCase, getCaseHistory, listCases } from './cases.query';
import { MAX_TIMEOUT_SECONDS } from './constants';
import { DISCORD_MODERATION_APPLY_JOB, moderationApplyPayloadSchema } from './discord-jobs';
import { jobHandlers } from './index';
import { SWEEP_EXPIRED_JOB } from './sweeps';
import {
  INTEGRATION_TIMEOUTS,
  auditsOf,
  configureModeration,
  eventsOf,
  jobsOfType,
  MODERATOR_ROLE_ID,
  notificationsFor,
  QUARANTINE_ROLE_ID,
  VERIFIED_ROLE_ID,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

describe('moderation cases', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let core: UserActor;
  let target: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    target = await kit.member({ roles: ['verified'], username: 'target' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const applyJobs = async () =>
    (await jobsOfType(kit, DISCORD_MODERATION_APPLY_JOB)).map((job) =>
      moderationApplyPayloadSchema.parse(job.payload),
    );
  const standing = async (actor: UserActor) =>
    (await kit.db.select().from(members).where(eq(members.id, actor.memberId!)))[0]?.standing;

  describe('warn', () => {
    it('records the case, audits, publishes, queues the DM and notifies the target', async () => {
      const view = await warnMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Keep it civil in #general.',
      });
      expect(view).toMatchObject({
        action: 'warn',
        source: 'manual',
        reference: 'CASE-0001',
        discordSync: 'pending',
        inForce: false,
        moderator: { userId: moderator.userId },
        target: { userId: target.userId, discordId: target.discordId },
      });

      const [audit] = await auditsOf(kit, 'moderation.case_created');
      expect(audit).toMatchObject({ actorUserId: moderator.userId, targetId: target.userId });
      const [event] = await eventsOf(kit, 'moderation.case_created');
      expect(event).toMatchObject({ subjectMemberId: target.memberId, aggregateId: view.id });

      const [payload] = await applyJobs();
      expect(payload).toMatchObject({
        caseId: view.id,
        action: 'warn',
        targetDiscordId: target.discordId,
      });
      expect(payload?.dmText).toContain('WARNING ISSUED');
      expect(payload?.dmText).toContain('Keep it civil');
      expect(payload?.auditReason).toMatch(/^JAVE CASE-0001 — /);

      const [notice] = await notificationsFor(kit, target.userId, 'moderation.notice');
      expect(notice).toMatchObject({ title: 'WARNING ISSUED', severity: 'important' });
      // Inbox only: the DM comes from the apply job, never twice.
      const deliveries = await kit.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationId, notice!.id));
      expect(deliveries).toHaveLength(0);
    });

    it('accepts a Discord ID as the target', async () => {
      const view = await warnMember(kit.as(moderator), {
        targetDiscordId: target.discordId,
        reason: 'Spoilers without tags.',
      });
      expect(view.target.userId).toBe(target.userId);
    });

    it('does not DM members who left; the inbox notice remains', async () => {
      await recordGuildLeave(kit.system, target.discordId);
      const view = await warnMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Posted before leaving.',
      });
      expect(view.discordSync).toBe('not_required');
      expect(await applyJobs()).toHaveLength(0);
      expect(await notificationsFor(kit, target.userId, 'moderation.notice')).toHaveLength(1);
    });
  });

  describe('timeout', () => {
    it('times out, replaces a running timeout and lifts it', async () => {
      const first = await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Cool off.',
        durationSeconds: HOUR / 1000,
      });
      expect(first.expiresAt?.toISOString()).toBe(
        new Date(kit.clock.now().getTime() + HOUR).toISOString(),
      );
      expect(first.inForce).toBe(true);
      const [payload] = await applyJobs();
      expect(payload?.timeoutUntil).toBe(first.expiresAt?.toISOString());

      const second = await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Extended.',
        durationSeconds: (2 * HOUR) / 1000,
      });
      expect((await getCase(kit.as(moderator), first.id)).endedReason).toBe('superseded');

      const lifted = await untimeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Resolved in DMs.',
      });
      expect(lifted.revertsCaseId).toBe(second.id);
      const secondAfter = await getCase(kit.as(moderator), second.id);
      expect(secondAfter).toMatchObject({ endedReason: 'lifted', inForce: false });
      await expect(
        untimeoutMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Again?' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('accepts exactly 28 days and rejects anything longer or under a minute', async () => {
      await expect(
        timeoutMember(kit.as(moderator), {
          targetUserId: target.userId,
          reason: 'Too long.',
          durationSeconds: MAX_TIMEOUT_SECONDS + 1,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        timeoutMember(kit.as(moderator), {
          targetUserId: target.userId,
          reason: 'Too short.',
          durationSeconds: 59,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      const max = await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Maximum.',
        durationSeconds: MAX_TIMEOUT_SECONDS,
      });
      expect(max.durationSeconds).toBe(2_419_200);
    });

    it('treats an expired timeout as not in force', async () => {
      await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Short.',
        durationSeconds: 60,
      });
      kit.clock.advance(MINUTE);
      await expect(
        untimeoutMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Lift.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      const again = await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'New one.',
        durationSeconds: 60,
      });
      expect(again.inForce).toBe(true);
    });

    it('refuses members who are not in the server', async () => {
      await recordGuildLeave(kit.system, target.discordId);
      await expect(
        timeoutMember(kit.as(moderator), {
          targetUserId: target.userId,
          reason: 'Gone.',
          durationSeconds: 600,
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
      await expect(
        kickMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Gone.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe('ban', () => {
    it('bans with message deletion, blocks access and unbans', async () => {
      const ban = await banMember(kit.as(core), {
        targetUserId: target.userId,
        reason: 'Scam links.',
        deleteMessageDays: 7,
      });
      expect(ban.deleteMessageDays).toBe(7);
      const [payload] = await applyJobs();
      expect(payload).toMatchObject({ action: 'ban', deleteMessageSeconds: 604_800 });
      expect(await standing(target)).toBe('banned');
      expect((await resolveUserActor(kit.system, target.userId)).capabilities.size).toBe(0);

      await expect(
        banMember(kit.as(core), { targetUserId: target.userId, reason: 'Twice.' }),
      ).rejects.toBeInstanceOf(ConflictError);

      const unban = await unbanMember(kit.as(core), {
        targetUserId: target.userId,
        reason: 'Appeal accepted.',
      });
      expect(unban.revertsCaseId).toBe(ban.id);
      expect(await standing(target)).toBe('good');
    });

    it('rejects out-of-range message deletion', async () => {
      await expect(
        banMember(kit.as(core), {
          targetUserId: target.userId,
          reason: 'Nope.',
          deleteMessageDays: 8,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('supersedes a live quarantine and timeout', async () => {
      const quarantine = await quarantineMember(kit.as(core), {
        targetUserId: target.userId,
        reason: 'Hold.',
      });
      await banMember(kit.as(core), { targetUserId: target.userId, reason: 'Confirmed raider.' });
      expect((await getCase(kit.as(core), quarantine.id)).endedReason).toBe('superseded');
      expect(await standing(target)).toBe('banned');
    });

    it('bans users who were never members (pre-emptive)', async () => {
      const departed = await kit.member({ inGuild: false });
      const ban = await banMember(kit.as(core), {
        targetUserId: departed.userId,
        reason: 'Known raider.',
      });
      expect(ban.discordSync).toBe('pending');
    });
  });

  describe('quarantine', () => {
    it('quarantines with the configured role, strips managed roles and releases', async () => {
      const q = await quarantineMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Compromised account suspected.',
        durationSeconds: HOUR / 1000,
      });
      expect(q.inForce).toBe(true);
      expect(await standing(target)).toBe('quarantined');
      const [payload] = await applyJobs();
      expect(payload).toMatchObject({ action: 'quarantine', quarantineRoleId: QUARANTINE_ROLE_ID });
      expect(payload?.managedRoleIds?.sort()).toEqual([MODERATOR_ROLE_ID, VERIFIED_ROLE_ID].sort());

      await expect(
        quarantineMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Again.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);

      const release = await releaseMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Owner confirmed.',
      });
      expect(release.revertsCaseId).toBe(q.id);
      expect(await standing(target)).toBe('good');
      expect(await jobsOfType(kit, 'discord.roles.sync')).not.toHaveLength(0);
      await expect(
        releaseMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Again.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('enforces quarantine as a Discord timeout when no quarantine role is configured', async () => {
      await updateSettings(kit.system, 'roles', { quarantineRoleId: undefined });
      const q = await quarantineMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Hold.',
      });
      // Never a silent no-op: the member is restricted in Discord either way.
      expect(q.discordSync).toBe('pending');
      const [job] = await applyJobs();
      expect(job).toMatchObject({ action: 'quarantine', quarantineFallback: 'timeout' });
      expect(await standing(target)).toBe('quarantined');
      expect(await notificationsFor(kit, moderator.userId, 'moderation.sync_failed')).toHaveLength(
        0,
      );
    });

    it('records quarantine of departed members for re-application on rejoin', async () => {
      await recordGuildLeave(kit.system, target.discordId);
      const q = await quarantineMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Left mid-investigation.',
      });
      expect(q.discordSync).toBe('not_required');
      expect(await standing(target)).toBe('quarantined');
    });

    it('releases expired quarantines on the sweep, at the exact expiry', async () => {
      const q = await quarantineMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Timed hold.',
        durationSeconds: HOUR / 1000,
      });
      kit.clock.advance(HOUR - 1);
      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB);
      let outcomes = await kit.drain(jobHandlers);
      expect(outcomes[0]?.result).toMatchObject({ quarantinesReleased: 0 });
      expect(await standing(target)).toBe('quarantined');

      kit.clock.advance(1);
      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB);
      outcomes = await kit.drain(jobHandlers);
      expect(outcomes[0]?.result).toMatchObject({ quarantinesReleased: 1 });
      expect(await standing(target)).toBe('good');
      const history = await getCaseHistory(kit.as(moderator), { targetUserId: target.userId });
      const release = history.cases.find((c) => c.action === 'release');
      expect(release).toMatchObject({ source: 'system', moderator: null, revertsCaseId: q.id });
      expect((await getCase(kit.as(moderator), q.id)).endedReason).toBe('expired');
      const releasePayload = (await applyJobs()).find((p) => p.action === 'release');
      expect(releasePayload?.quarantineRoleId).toBe(QUARANTINE_ROLE_ID);
      const notices = await notificationsFor(kit, target.userId, 'moderation.notice');
      expect(notices.map((n) => n.title)).toContain('QUARANTINE LIFTED');

      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB, {}, { dedupeKey: 'again' });
      outcomes = await kit.drain(jobHandlers);
      expect(outcomes[0]?.result).toMatchObject({ quarantinesReleased: 0 });
    });

    it('closes timeouts Discord already lifted', async () => {
      await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Brief.',
        durationSeconds: 60,
      });
      kit.clock.advance(MINUTE);
      await enqueueJob(kit.system, SWEEP_EXPIRED_JOB);
      const [outcome] = await kit.drain(jobHandlers);
      expect(outcome?.result).toMatchObject({ timeoutsClosed: 1 });
      const [row] = await kit.db.select().from(modCases);
      expect(row?.endedReason).toBe('expired');
    });
  });

  describe('notes', () => {
    it('are staff-only: no Discord job, no notice to the member', async () => {
      const note = await addModNote(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Mentioned alt accounts in ticket #0042.',
      });
      expect(note.discordSync).toBe('not_required');
      expect(await applyJobs()).toHaveLength(0);
      expect(await notificationsFor(kit, target.userId)).toHaveLength(0);
    });
  });

  describe('Discord sync callback', () => {
    it('marks applied idempotently and records failures for the moderator', async () => {
      const warn = await warnMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'First.',
      });
      expect(
        await markCaseSynced(kit.system, {
          caseId: warn.id,
          status: 'failed',
          error: 'Cannot send messages to this user (DMs closed) token=abc',
        }),
      ).toEqual({ discordSync: 'failed', changed: true });
      const failed = await getCase(kit.as(moderator), warn.id);
      expect(failed.discordError).toContain('DMs closed');
      expect(await auditsOf(kit, 'moderation.case_sync_failed')).toHaveLength(1);
      expect(await notificationsFor(kit, moderator.userId, 'moderation.sync_failed')).toHaveLength(
        1,
      );

      expect(await markCaseSynced(kit.system, { caseId: warn.id, status: 'applied' })).toEqual({
        discordSync: 'applied',
        changed: true,
      });
      expect(await markCaseSynced(kit.system, { caseId: warn.id, status: 'failed' })).toEqual({
        discordSync: 'applied',
        changed: false,
      });
      expect((await getCase(kit.as(moderator), warn.id)).discordSyncedAt).not.toBeNull();
    });

    it('rejects callbacks for cases without a Discord action', async () => {
      const note = await addModNote(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Context.',
      });
      await expect(
        markCaseSynced(kit.system, { caseId: note.id, status: 'applied' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('truncates huge error reports', async () => {
      const warn = await warnMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'x x x',
      });
      await markCaseSynced(kit.system, {
        caseId: warn.id,
        status: 'failed',
        error: 'e'.repeat(2000),
      });
      const [row] = await kit.db.select().from(modCases).where(eq(modCases.id, warn.id));
      expect(row?.discordError?.length).toBeLessThanOrEqual(500);
      await expect(
        markCaseSynced(kit.system, { caseId: warn.id, status: 'failed', error: 'e'.repeat(2001) }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('revocation', () => {
    it('strikes a warning from the record', async () => {
      const warn = await warnMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Mistaken identity.',
      });
      const result = await revokeCase(kit.as(moderator), {
        caseId: warn.id,
        reason: 'Wrong member.',
      });
      expect(result.reversal).toBeNull();
      expect(result.case.revokedBy?.userId).toBe(moderator.userId);
      expect(await auditsOf(kit, 'moderation.case_revoked')).toHaveLength(1);
      expect(await eventsOf(kit, 'moderation.case_revoked')).toHaveLength(1);
      await expect(
        revokeCase(kit.as(moderator), { caseId: warn.id, reason: 'Again.' }),
      ).rejects.toBeInstanceOf(ConflictError);
      const history = await getCaseHistory(kit.as(moderator), { targetUserId: target.userId });
      expect(history.summary.warnings).toBe(0);
    });

    it('lifts a live quarantine through a reversal case', async () => {
      const q = await quarantineMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Hold.',
      });
      const result = await revokeCase(kit.as(moderator), {
        caseId: q.id,
        reason: 'Appeal granted.',
      });
      expect(result.reversal).toMatchObject({ action: 'release', revertsCaseId: q.id });
      expect(result.reversal?.reason).toBe('CASE-0001 revoked: Appeal granted.');
      expect(result.case).toMatchObject({ endedReason: 'revoked', inForce: false });
      expect(await standing(target)).toBe('good');
    });

    it('revoking an expired timeout needs no reversal', async () => {
      const t = await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Brief.',
        durationSeconds: 60,
      });
      kit.clock.advance(2 * MINUTE);
      const result = await revokeCase(kit.as(moderator), { caseId: t.id, reason: 'Overturned.' });
      expect(result.reversal).toBeNull();
      expect(result.case.endedReason).toBe('expired');
    });

    it('refuses to revoke reversal cases', async () => {
      await quarantineMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Hold.' });
      const release = await releaseMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Done.',
      });
      await expect(
        revokeCase(kit.as(moderator), { caseId: release.id, reason: 'Undo.' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });
  });

  describe('history and listing', () => {
    it('summarizes a member record and filters the case list', async () => {
      await warnMember(kit.as(moderator), { targetUserId: target.userId, reason: 'One.' });
      await warnMember(kit.as(moderator), { targetUserId: target.userId, reason: 'Two.' });
      await timeoutMember(kit.as(moderator), {
        targetUserId: target.userId,
        reason: 'Three.',
        durationSeconds: 600,
      });
      const other = await kit.member();
      await warnMember(kit.as(moderator), { targetUserId: other.userId, reason: 'Other.' });

      const history = await getCaseHistory(kit.as(moderator), {
        targetDiscordId: target.discordId,
      });
      expect(history.summary).toMatchObject({
        warnings: 2,
        quarantined: false,
        banned: false,
        totalCases: 3,
      });
      expect(history.summary.timeoutUntil).not.toBeNull();
      expect(history.cases.map((c) => c.action)).toEqual(['timeout', 'warn', 'warn']);

      const warns = await listCases(kit.as(moderator), { action: 'warn', limit: 2 });
      expect(warns.total).toBe(3);
      expect(warns.items).toHaveLength(2);
      const live = await listCases(kit.as(moderator), { liveOnly: true });
      expect(live.items.map((c) => c.action)).toEqual(['timeout']);
      const mine = await listCases(kit.as(moderator), { targetUserId: other.userId });
      expect(mine.total).toBe(1);
    });

    it('stores injection-shaped reasons literally', async () => {
      const reason = "'); DROP TABLE mod_cases; -- <script>alert(1)</script>";
      const view = await warnMember(kit.as(moderator), { targetUserId: target.userId, reason });
      expect((await getCase(kit.as(moderator), view.id)).reason).toBe(reason);
      const [notice] = await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, target.userId));
      expect(notice?.body).toContain('<script>');
    });
  });
});
