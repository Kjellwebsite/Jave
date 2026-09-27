import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { modCases, notifications, securityEvents, serverSettings } from '@jave/database';
import {
  createContext,
  getSettings,
  moderation,
  type JobRecord,
  PermanentJobError,
  silentLogger,
  systemActor,
  updateSettings,
} from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { alertCardPayload, riskBar } from './alert-card';
import { moderationAlertHandler } from './alert-job';
import { moderationApplyHandler } from './apply-job';
import { moderationDeleteMessagesHandler, moderationLockdownHandler } from './message-jobs';
import {
  ALERT_CHANNEL_ID,
  CHAT_CHANNEL_ID,
  configureModeration,
  customIdsOf,
  jobsOfType,
  snowflakeAt,
} from './test-support';

const DAY_MS = 86_400_000;

describe('moderation feature — Discord job handlers', () => {
  let bot: BotHarness;

  beforeEach(async () => {
    bot = await createBotHarness();
    await configureModeration(bot);
  });
  afterEach(async () => {
    await bot.close();
  });

  const systemCtx = () =>
    createContext({
      db: bot.kit.db,
      clock: bot.kit.clock,
      cache: bot.kit.cache,
      logger: silentLogger,
      actor: systemActor('test:job'),
    });

  const applyJobs = () => jobsOfType(bot, moderation.DISCORD_MODERATION_APPLY_JOB);
  const caseRow = async (caseId: string) =>
    (await bot.kit.db.select().from(modCases).where(eq(modCases.id, caseId)))[0]!;

  async function setup() {
    const mod = await bot.member({ roles: ['moderator'], username: 'mod' });
    const core = await bot.member({ roles: ['core'], username: 'core' });
    const target = await bot.member({ username: 'target' });
    return { mod, core, target };
  }

  describe('discord.moderation.apply', () => {
    it('reports closed DMs on a warning as a failed sync, notifies the moderator, completes', async () => {
      const { mod, target } = await setup();
      bot.gateway.closedDms.add(target.user.id);
      const view = await moderation.warnMember(bot.kit.as(mod.actor), {
        targetUserId: target.actor.userId,
        reason: 'Rule 2',
      });
      await bot.drain();
      const record = await caseRow(view.id);
      expect(record).toMatchObject({ discordSync: 'failed' });
      expect(record.discordError).toContain('DMs closed');
      const [job] = await applyJobs();
      expect(job?.status).toBe('completed');
      const alerts = await bot.kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, mod.actor.userId));
      expect(alerts.map((n) => n.title)).toContain('DISCORD SYNC FAILED — CASE-0001');
    });

    it('BREAK: a missing Discord permission fails the sync and dead-letters the job', async () => {
      const { core, target } = await setup();
      bot.gateway.failures.set(
        'ban',
        new DiscordActionError('ban failed: Missing Permissions', 50013, true),
      );
      const view = await moderation.banMember(bot.kit.as(core.actor), {
        targetUserId: target.actor.userId,
        reason: 'Scam',
      });
      await bot.drain();
      expect((await caseRow(view.id)).discordSync).toBe('failed');
      const [job] = await applyJobs();
      expect(job?.status).toBe('dead');
    });

    it('retries transient failures and keeps the case pending', async () => {
      const { mod, target } = await setup();
      bot.gateway.failures.set('timeout', new DiscordActionError('gateway timeout', 500, false));
      const view = await moderation.timeoutMember(bot.kit.as(mod.actor), {
        targetUserId: target.actor.userId,
        reason: 'Cool down',
        durationSeconds: 600,
      });
      await bot.drain();
      const [job] = await applyJobs();
      expect(job?.status).toBe('pending');
      expect((await caseRow(view.id)).discordSync).toBe('pending');
      bot.kit.clock.advance(60_000);
      await bot.drain();
      expect((await caseRow(view.id)).discordSync).toBe('applied');
      // The notice went out once, on the first attempt only.
      expect(bot.gateway.dms.filter((d) => d.userId === target.user.id)).toHaveLength(1);
    });

    it('treats a member who already left as a routine failure (job completes)', async () => {
      const { mod, target } = await setup();
      bot.gateway.failures.set('kick', new DiscordActionError('Unknown Member', 10007, true));
      const view = await moderation.kickMember(bot.kit.as(mod.actor), {
        targetUserId: target.actor.userId,
        reason: 'Spam',
      });
      await bot.drain();
      expect((await caseRow(view.id)).discordSync).toBe('failed');
      expect((await applyJobs())[0]?.status).toBe('completed');
    });

    it('skips a case that was revoked while its job waited', async () => {
      const { core, target } = await setup();
      const view = await moderation.banMember(bot.kit.as(core.actor), {
        targetUserId: target.actor.userId,
        reason: 'Mistaken identity',
      });
      const [job] = await applyJobs();
      await moderation.revokeCase(bot.kit.as(core.actor), {
        caseId: view.id,
        reason: 'Wrong user',
      });
      const handler = moderationApplyHandler(bot.app.services);
      const result = await handler(systemCtx(), job!.payload, job as JobRecord);
      expect(result).toEqual({ skipped: 'revoked' });
      expect(bot.gateway.callsTo('ban')).toHaveLength(0);
    });

    it('counts "Unknown Ban" as an applied unban', async () => {
      const { core, target } = await setup();
      await moderation.banMember(bot.kit.as(core.actor), {
        targetUserId: target.actor.userId,
        reason: 'Scam',
      });
      await bot.drain();
      bot.gateway.failures.set('unban', new DiscordActionError('Unknown Ban', 10026, true));
      const unban = await moderation.unbanMember(bot.kit.as(core.actor), {
        targetUserId: target.actor.userId,
        reason: 'Appeal',
      });
      await bot.drain();
      expect((await caseRow(unban.id)).discordSync).toBe('applied');
    });

    it('BREAK: rejects forged payloads permanently', async () => {
      const handler = moderationApplyHandler(bot.app.services);
      await expect(
        handler(systemCtx(), { caseId: 'nope', action: 'ban' }, {} as JobRecord),
      ).rejects.toBeInstanceOf(PermanentJobError);
    });

    it('escapes the reason in the DM and never pings', async () => {
      const { mod, target } = await setup();
      await moderation.warnMember(bot.kit.as(mod.actor), {
        targetUserId: target.actor.userId,
        reason: '@everyone look at **this** <@123456789012345678>',
      });
      await bot.drain();
      const description = bot.gateway.dms[0]?.payload.embeds?.[0]?.description ?? '';
      expect(description).not.toContain('@everyone');
      expect(description).toContain('\\*\\*this\\*\\*');
      expect(description).not.toMatch(/<@123456789012345678>/);
    });
  });

  describe('discord.moderation.alert', () => {
    async function event() {
      return moderation.recordSecurityEvent(bot.kit.system, {
        discordUser: { discordId: '320000000000000001', username: 'spammer' },
        trigger: 'foreign_invite',
        riskScore: 45,
        signals: [{ key: 'foreign_invite', weight: 45, detail: 'discord.gg/abc' }],
        channelId: CHAT_CHANNEL_ID,
        messageIds: ['330000000000000001'],
        excerpt: 'join **now** @everyone discord.gg/abc',
        actionTaken: 'message_deleted',
      });
    }

    it('posts once, records the card, and edits instead of re-posting on a retry', async () => {
      const view = await event();
      const [job] = await jobsOfType(bot, moderation.DISCORD_MODERATION_ALERT_JOB);
      const handler = moderationAlertHandler(bot.app.services);
      await handler(systemCtx(), job!.payload, job as JobRecord);
      await handler(systemCtx(), job!.payload, job as JobRecord);
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(1);
      expect(bot.gateway.callsTo('editMessage')).toHaveLength(1);
      const [row] = await bot.kit.db
        .select()
        .from(securityEvents)
        .where(eq(securityEvents.id, view.id));
      expect(row?.alertChannelId).toBe(ALERT_CHANNEL_ID);
      const card = bot.gateway.callsTo('sendMessage')[0]!.args[1] as {
        embeds: { fields: { name: string; value: string }[] }[];
      };
      const evidence = card.embeds[0]!.fields.find((f) => f.name === 'EVIDENCE')!.value;
      expect(evidence).not.toContain('@everyone');
      expect(evidence).toContain('\\*\\*now\\*\\*');
      const risk = card.embeds[0]!.fields.find((f) => f.name === 'RISK SCORE')!.value;
      expect(risk).toContain('45/100');
    });

    it('a review that lands while the card is being posted still reaches the card', async () => {
      const { mod } = await setup();
      const view = await event();
      const [job] = await jobsOfType(bot, moderation.DISCORD_MODERATION_ALERT_JOB);
      const send = bot.gateway.sendMessage.bind(bot.gateway);
      bot.gateway.sendMessage = async (channelId, payload) => {
        const sent = await send(channelId, payload);
        // Dismissed after the card was rendered, before the bot recorded where it was posted.
        await moderation.reviewSecurityEvent(bot.kit.as(mod.actor), {
          securityEventId: view.id,
          status: 'dismissed',
        });
        return sent;
      };
      await moderationAlertHandler(bot.app.services)(systemCtx(), job!.payload, job as JobRecord);
      const [posted] = bot.gateway.callsTo('sendMessage');
      expect(customIdsOf(posted!.args[1] as { components?: unknown[] })).not.toEqual([]);
      const edits = bot.gateway.callsTo('editMessage');
      expect(edits).toHaveLength(1);
      expect(customIdsOf(edits[0]!.args[2] as { components?: unknown[] })).toEqual([]);
    });

    it('BREAK: a deleted alert channel dead-letters the job instead of retrying forever', async () => {
      bot.gateway.failures.set(
        'sendMessage',
        new DiscordActionError('Unknown Channel', 10003, true),
      );
      await event();
      await bot.drain();
      const [job] = await jobsOfType(bot, moderation.DISCORD_MODERATION_ALERT_JOB);
      expect(job?.status).toBe('dead');
    });

    it('does nothing when no alert channel is configured', async () => {
      await updateSettings(bot.kit.system, 'channels', { securityAlerts: undefined });
      await event();
      await bot.drain();
      expect(await jobsOfType(bot, moderation.DISCORD_MODERATION_ALERT_JOB)).toHaveLength(0);
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    });

    it('renders buttons only while actionable', () => {
      const base = {
        securityEventId: '00000000-0000-4000-8000-000000000001',
        reference: 'SEC-0001',
        title: 'SECURITY EVENT SEC-0001 — MANUAL REPORT',
        severity: 'unscored' as const,
        subjectDiscordId: null,
        quarantineOffered: false,
        fields: [{ label: 'RISK SCORE', value: '0/100' }],
        timestamp: new Date(),
      };
      expect(customIdsOf(alertCardPayload({ ...base, status: 'open', actionable: true }))).toEqual([
        'moderation:sec-ack:00000000-0000-4000-8000-000000000001',
        'moderation:sec-dismiss:00000000-0000-4000-8000-000000000001',
      ]);
      expect(
        customIdsOf(alertCardPayload({ ...base, status: 'dismissed', actionable: false })),
      ).toEqual([]);
      expect(riskBar(45)).toBe('▰▰▰▰▰▱▱▱▱▱ 45/100');
      expect(riskBar(250)).toBe('▰▰▰▰▰▰▰▰▰▰ 100/100');
    });
  });

  describe('discord.moderation.delete_messages', () => {
    it('bulk-deletes recent messages, deletes old ones singly, and tolerates missing ones', async () => {
      const now = bot.kit.clock.now().getTime();
      const recentA = snowflakeAt(new Date(now - 60_000));
      const recentB = snowflakeAt(new Date(now - 120_000));
      const old = snowflakeAt(new Date(now - 15 * DAY_MS));
      bot.gateway.failures.set(
        'deleteMessage',
        new DiscordActionError('Unknown Message', 10008, true),
      );
      const handler = moderationDeleteMessagesHandler(bot.app.services);
      const result = await handler(
        systemCtx(),
        { channelId: CHAT_CHANNEL_ID, messageIds: [recentA, recentB, old], auditReason: 'automod' },
        {} as JobRecord,
      );
      expect(bot.gateway.callsTo('deleteMessages')[0]?.args[1]).toEqual([recentA, recentB]);
      expect(bot.gateway.callsTo('deleteMessage')[0]?.args[1]).toBe(old);
      expect(result).toEqual({ deleted: 2, requested: 3 });
    });

    it('BREAK: missing Manage Messages is permanent', async () => {
      bot.gateway.failures.set(
        'deleteMessage',
        new DiscordActionError('Missing Permissions', 50013, true),
      );
      const handler = moderationDeleteMessagesHandler(bot.app.services);
      await expect(
        handler(
          systemCtx(),
          {
            channelId: CHAT_CHANNEL_ID,
            messageIds: [snowflakeAt(bot.kit.clock.now())],
            auditReason: 'automod',
          },
          {} as JobRecord,
        ),
      ).rejects.toBeInstanceOf(PermanentJobError);
    });
  });

  describe('discord.moderation.lockdown', () => {
    it('posts nothing for a flag that no longer matches raid mode', async () => {
      const handler = moderationLockdownHandler(bot.app.services);
      const result = await handler(
        systemCtx(),
        { enabled: true, reason: 'Burst', noticeChannelId: ALERT_CHANNEL_ID },
        {} as JobRecord,
      );
      expect(result).toEqual({ skipped: 'superseded' });
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    });

    it('reads the committed raid mode, not a stale per-process settings cache', async () => {
      const ctx = systemCtx();
      // This process cached raid mode OFF; another process (the dashboard) then switched it on.
      await getSettings(ctx, 'security');
      await bot.kit.db
        .update(serverSettings)
        .set({ value: { raidMode: true } })
        .where(eq(serverSettings.section, 'security'));
      await bot.kit.db
        .insert(serverSettings)
        .values({ section: 'security', value: { raidMode: true } })
        .onConflictDoNothing();
      expect((await getSettings(ctx, 'security')).raidMode).toBe(false);
      const handler = moderationLockdownHandler(bot.app.services);
      const result = await handler(
        ctx,
        { enabled: true, reason: 'Dashboard switch', noticeChannelId: ALERT_CHANNEL_ID },
        {} as JobRecord,
      );
      expect(result).toEqual({ posted: true, enabled: true });
      const [notice] = bot.gateway.callsTo('sendMessage');
      expect((notice?.args[1] as { embeds: { title: string }[] }).embeds[0]?.title).toBe(
        'RAID MODE — ON',
      );
    });

    it('skips cleanly without a notice channel', async () => {
      const handler = moderationLockdownHandler(bot.app.services);
      const result = await handler(
        systemCtx(),
        { enabled: false, reason: 'Calm' },
        {} as JobRecord,
      );
      expect(result).toEqual({ skipped: 'no notice channel' });
    });
  });

  it('every moderation discord.* contract has a registered handler', () => {
    for (const contract of moderation.DISCORD_JOB_CONTRACTS) {
      expect(bot.app.worker.handlerTypes).toContain(contract.type);
    }
  });
});
