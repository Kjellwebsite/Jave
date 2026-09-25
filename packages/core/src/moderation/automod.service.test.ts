import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { inviteCodes, members, modCases, securityEvents } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { applyAutomodDecision, screenMessage } from './automod.service';
import {
  DISCORD_MODERATION_APPLY_JOB,
  DISCORD_MODERATION_DELETE_MESSAGES_JOB,
  moderationApplyPayloadSchema,
  moderationDeleteMessagesPayloadSchema,
} from './discord-jobs';
import {
  INTEGRATION_TIMEOUTS,
  configureModeration,
  jobsOfType,
  MESSAGE_CHANNEL_ID,
  notificationsFor,
  snowflakeAt,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

const SECOND = 1000;
let messageSequence = 0;
const nextMessageId = () => `3400000000000${String(++messageSequence).padStart(5, '0')}`;

describe('automod service', () => {
  let kit: TestKit;
  let author: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    await kit.member({ roles: ['moderator'], username: 'mod' });
    author = await kit.member({ roles: ['verified'], username: 'author' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const profile = (actor: UserActor, username = 'author') => ({
    discordId: actor.discordId,
    username,
  });

  const screen = (content: string, overrides: Record<string, unknown> = {}) =>
    screenMessage(kit.system, {
      author: profile(author),
      channelId: MESSAGE_CHANNEL_ID,
      messageId: nextMessageId(),
      content,
      mentionCount: 0,
      ...overrides,
    });

  const deleteJobs = async () =>
    (await jobsOfType(kit, DISCORD_MODERATION_DELETE_MESSAGES_JOB)).map((job) =>
      moderationDeleteMessagesPayloadSchema.parse(job.payload),
    );

  it('lets clean messages through without writing anything', async () => {
    const result = await screen('shipped the parser today');
    expect(result.evaluation.action).toBe('none');
    expect(result.outcome.applied).toBe('none');
    expect(await kit.db.select().from(securityEvents)).toHaveLength(0);
  });

  it('deletes a foreign invite and records the event', async () => {
    const messageId = nextMessageId();
    const result = await screen('join discord.gg/elsewhere', { messageId });
    expect(result.outcome).toMatchObject({ applied: 'delete', caseId: null, duplicate: false });
    const [event] = await kit.db.select().from(securityEvents);
    expect(event).toMatchObject({
      source: 'automod',
      trigger: 'foreign_invite',
      actionTaken: 'message_deleted',
      userId: author.userId,
      dedupeKey: `automod:${messageId}`,
    });
    expect(await deleteJobs()).toEqual([
      expect.objectContaining({
        channelId: MESSAGE_CHANNEL_ID,
        messageIds: [messageId],
        securityEventId: event!.id,
      }),
    ]);
    expect(await kit.db.select().from(modCases)).toHaveLength(0);
  });

  it('allows invites to this server from the invite mirror', async () => {
    await kit.db.insert(inviteCodes).values({ code: 'javelin' });
    const result = await screen('come to discord.gg/javelin');
    expect(result.evaluation.action).toBe('none');
  });

  it('times out spam with an automod case (no moderator)', async () => {
    const now = kit.clock.now().getTime();
    const recent = Array.from({ length: 7 }, (_, i) => ({
      content: `message ${i}`,
      at: new Date(now - (i + 1) * SECOND),
    }));
    const result = await screen('message 8', { recent });
    expect(result.outcome.applied).toBe('timeout');
    const [record] = await kit.db.select().from(modCases);
    expect(record).toMatchObject({
      action: 'timeout',
      source: 'automod',
      moderatorUserId: null,
      durationSeconds: 600,
      securityEventId: result.outcome.securityEventId,
    });
    const [apply] = (await jobsOfType(kit, DISCORD_MODERATION_APPLY_JOB)).map((j) =>
      moderationApplyPayloadSchema.parse(j.payload),
    );
    expect(apply?.action).toBe('timeout');
    const [notice] = await notificationsFor(kit, author.userId, 'moderation.notice');
    expect(notice?.title).toBe('TIMEOUT — 10M');

    // Another violation while timed out: delete only, no second case.
    const again = await screen('message 9', { recent });
    expect(again.outcome).toMatchObject({ applied: 'delete', note: 'already timed out' });
    expect(await kit.db.select().from(modCases)).toHaveLength(1);
  });

  it('quarantines a raid-bot message from a brand-new account', async () => {
    const fresh = await kit.member({ discordId: snowflakeAt(kit.clock.now()) });
    const result = await screenMessage(kit.system, {
      author: profile(fresh, 'fresh'),
      channelId: MESSAGE_CHANNEL_ID,
      messageId: nextMessageId(),
      content: '@everyone FREE NITRO discord.gg/raid',
      mentionCount: 8,
    });
    expect(result.evaluation.riskScore).toBe(100);
    expect(result.outcome.applied).toBe('quarantine');
    const [member] = await kit.db.select().from(members).where(eq(members.id, fresh.memberId!));
    expect(member?.standing).toBe('quarantined');
  });

  it('processes a redelivered message once', async () => {
    const messageId = nextMessageId();
    const first = await screen('discord.gg/one', { messageId });
    const second = await screen('discord.gg/one', { messageId });
    expect(second.outcome).toMatchObject({
      duplicate: true,
      securityEventId: first.outcome.securityEventId,
    });
    expect(await kit.db.select().from(securityEvents)).toHaveLength(1);
    expect(await deleteJobs()).toHaveLength(1);
  });

  it('honours automodEnabled and caller exemptions', async () => {
    expect((await screen('discord.gg/x', { exempt: true })).outcome.applied).toBe('none');
    await updateSettings(kit.system, 'moderation', { automodEnabled: false });
    expect((await screen('discord.gg/x')).outcome.applied).toBe('none');
    expect(await kit.db.select().from(securityEvents)).toHaveLength(0);
  });

  it('BREAK: never actions staff, even with a forged evaluation', async () => {
    const staff = await kit.member({ roles: ['core'] });
    expect(
      (
        await screenMessage(kit.system, {
          author: profile(staff, 'staffer'),
          channelId: MESSAGE_CHANNEL_ID,
          messageId: nextMessageId(),
          content: 'discord.gg/partner',
          mentionCount: 0,
        })
      ).outcome.applied,
    ).toBe('none');

    const outcome = await applyAutomodDecision(kit.system, {
      discordUser: profile(staff, 'staffer'),
      evaluation: {
        signals: [{ key: 'spam_rate', weight: 99 }],
        riskScore: 99,
        action: 'quarantine',
        trigger: 'spam_rate',
      },
      channelId: MESSAGE_CHANNEL_ID,
      messageIds: [nextMessageId()],
    });
    expect(outcome).toMatchObject({ applied: 'flagged', caseId: null });
    const [event] = await kit.db.select().from(securityEvents);
    expect(event?.actionTaken).toBe('flagged');
    expect(await kit.db.select().from(modCases)).toHaveLength(0);
    expect(await deleteJobs()).toHaveLength(0);
  });

  it('BREAK: never actions configured exempt roles', async () => {
    await updateSettings(kit.system, 'moderation', {
      exemptRoles: ['founder', 'core', 'operations', 'moderator', 'verified'],
    });
    const outcome = await applyAutomodDecision(kit.system, {
      discordUser: profile(author),
      evaluation: {
        signals: [{ key: 'foreign_invite', weight: 45 }],
        riskScore: 70,
        action: 'timeout',
        trigger: 'foreign_invite',
      },
      channelId: MESSAGE_CHANNEL_ID,
      messageIds: [nextMessageId()],
    });
    expect(outcome.applied).toBe('flagged');
  });

  it('BREAK: rejects malformed evaluations', async () => {
    await expect(
      applyAutomodDecision(kit.system, {
        discordUser: profile(author),
        evaluation: {
          signals: [],
          riskScore: 1000,
          action: 'ban',
          trigger: 'spam_rate',
        } as never,
        channelId: MESSAGE_CHANNEL_ID,
        messageIds: [nextMessageId()],
      }),
    ).rejects.toThrow();
    await expect(
      applyAutomodDecision(kit.system, {
        discordUser: profile(author),
        evaluation: { signals: [], riskScore: 50, action: 'delete', trigger: 'spam_rate' },
        channelId: 'not-a-snowflake',
        messageIds: [],
      }),
    ).rejects.toThrow();
  });
});
