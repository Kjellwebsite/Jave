import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationDeliveries, securityEvents, users } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import { quarantineMember } from './cases.service';
import { DISCORD_MODERATION_ALERT_JOB, moderationAlertPayloadSchema } from './discord-jobs';
import { getSecurityAlertCard, getSecurityEvent, listSecurityEvents } from './security.query';
import {
  markSecurityAlertPosted,
  recordSecurityEvent,
  reviewSecurityEvent,
} from './security.service';
import {
  INTEGRATION_TIMEOUTS,
  ALERT_CHANNEL_ID,
  auditsOf,
  configureModeration,
  eventsOf,
  jobsOfType,
  MESSAGE_CHANNEL_ID,
  notificationsFor,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

const PROFILE = { discordId: '310000000000000001', username: 'spammer', displayName: 'Spam' };
const MESSAGE_ID = '320000000000000001';

describe('security events', () => {
  let kit: TestKit;
  let moderator: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const alertJobs = async () =>
    (await jobsOfType(kit, DISCORD_MODERATION_ALERT_JOB)).map((job) =>
      moderationAlertPayloadSchema.parse(job.payload),
    );

  const raise = (overrides: Record<string, unknown> = {}) =>
    recordSecurityEvent(kit.system, {
      discordUser: PROFILE,
      trigger: 'foreign_invite',
      riskScore: 45,
      signals: [{ key: 'foreign_invite', weight: 45, detail: 'discord.gg/abc' }],
      channelId: MESSAGE_CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      excerpt: 'join discord.gg/abc',
      actionTaken: 'message_deleted',
      ...overrides,
    });

  it('records a system event with bounded evidence, outbox event, staff inbox alert and card', async () => {
    const view = await raise();
    expect(view).toMatchObject({
      reference: 'SEC-0001',
      trigger: 'foreign_invite',
      source: 'system',
      status: 'open',
      riskScore: 45,
      created: true,
      user: { discordId: PROFILE.discordId, name: 'Spam' },
    });
    expect(view.evidence).toMatchObject({
      channelId: MESSAGE_CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      excerpt: 'join discord.gg/abc',
    });
    const [user] = await kit.db.select().from(users).where(eq(users.discordId, PROFILE.discordId));
    expect(user?.username).toBe('spammer');

    const [event] = await eventsOf(kit, 'security.event_raised');
    expect(event?.aggregateId).toBe(view.id);

    const [alert] = await notificationsFor(kit, moderator.userId, 'security.alert');
    expect(alert).toMatchObject({
      title: 'SECURITY EVENT — FOREIGN INVITE',
      severity: 'notice',
    });
    expect(alert?.body).toBe('SEC-0001 · risk 45/100 · @spammer · action message deleted');
    const deliveries = await kit.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, alert!.id));
    expect(deliveries).toHaveLength(0);

    expect(await alertJobs()).toEqual([
      { securityEventId: view.id, mode: 'post', channelId: ALERT_CHANNEL_ID },
    ]);
  });

  it('escalates to a critical DM alert at the quarantine threshold', async () => {
    await raise({ riskScore: 85, trigger: 'blocked_link' });
    const [alert] = await notificationsFor(kit, moderator.userId, 'security.alert');
    expect(alert).toMatchObject({ title: 'SECURITY ALERT — BLOCKED LINK', severity: 'critical' });
    const deliveries = await kit.db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.notificationId, alert!.id));
    expect(deliveries.map((d) => d.channel)).toEqual(['discord_dm']);
  });

  it('skips the alert card when no channel is configured', async () => {
    await updateSettings(kit.system, 'channels', { securityAlerts: undefined });
    await raise();
    expect(await alertJobs()).toHaveLength(0);
  });

  it('is idempotent on the dedupe key', async () => {
    const first = await raise({ dedupeKey: 'automod:1' });
    const second = await raise({ dedupeKey: 'automod:1' });
    expect(second).toMatchObject({ id: first.id, created: false });
    expect(await kit.db.select().from(securityEvents)).toHaveLength(1);
    expect(await notificationsFor(kit, moderator.userId, 'security.alert')).toHaveLength(1);
  });

  it('truncates and redacts the excerpt and strips invisible characters', async () => {
    const token = `M${'a'.repeat(23)}.abcdef.${'b'.repeat(27)}`;
    const view = await raise({ excerpt: `leak ${token} ‮evil ${'x'.repeat(1000)}` });
    const excerpt = view.evidence.excerpt ?? '';
    expect(excerpt.length).toBeLessThanOrEqual(300);
    expect(excerpt).toContain('[REDACTED]');
    expect(excerpt).not.toContain(token);
    expect(excerpt).not.toContain('‮');
  });

  it('rejects oversized evidence', async () => {
    await expect(
      raise({ messageIds: Array.from({ length: 21 }, (_, i) => `3200000000000000${10 + i}`) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(raise({ excerpt: 'x'.repeat(8001) })).rejects.toBeInstanceOf(ValidationError);
    await expect(raise({ riskScore: 101 })).rejects.toBeInstanceOf(ValidationError);
    await expect(raise({ signals: [{ key: 'Bad Key', weight: 1 }] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('lets staff file manual reports (audited, reporter not self-notified)', async () => {
    const other = await kit.member({ roles: ['moderator'] });
    const suspect = await kit.member();
    const view = await recordSecurityEvent(kit.as(moderator), {
      targetUserId: suspect.userId,
      trigger: 'manual_report',
      riskScore: 30,
      excerpt: 'DM’d members a fake giveaway.',
    });
    expect(view).toMatchObject({
      source: 'manual',
      reportedBy: { userId: moderator.userId },
      trigger: 'manual_report',
    });
    expect(await auditsOf(kit, 'security.event_reported')).toHaveLength(1);
    expect(await notificationsFor(kit, moderator.userId, 'security.alert')).toHaveLength(0);
    expect(await notificationsFor(kit, other.userId, 'security.alert')).toHaveLength(1);
  });

  describe('review', () => {
    it('walks open → acknowledged → dismissed and refreshes the posted card', async () => {
      const view = await raise();
      await markSecurityAlertPosted(kit.system, {
        securityEventId: view.id,
        channelId: ALERT_CHANNEL_ID,
        messageId: '330000000000000001',
      });
      const acknowledged = await reviewSecurityEvent(kit.as(moderator), {
        securityEventId: view.id,
        status: 'acknowledged',
      });
      expect(acknowledged).toMatchObject({
        status: 'acknowledged',
        reviewedBy: { userId: moderator.userId },
      });
      const dismissed = await reviewSecurityEvent(kit.as(moderator), {
        securityEventId: view.id,
        status: 'dismissed',
        note: 'Partner server invite, approved.',
      });
      expect(dismissed.reviewNote).toBe('Partner server invite, approved.');
      expect(await auditsOf(kit, 'security.event_reviewed')).toHaveLength(2);
      expect(await eventsOf(kit, 'security.event_reviewed')).toHaveLength(2);
      const updates = (await alertJobs()).filter((job) => job.mode === 'update');
      expect(updates[0]).toMatchObject({ messageId: '330000000000000001' });

      await expect(
        reviewSecurityEvent(kit.as(moderator), {
          securityEventId: view.id,
          status: 'acknowledged',
        }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('marks the event actioned when a moderator acts on it', async () => {
      const view = await raise();
      await quarantineMember(kit.as(moderator), {
        targetUserId: view.user!.userId,
        reason: 'From the alert.',
        securityEventId: view.id,
      });
      const detail = await getSecurityEvent(kit.as(moderator), view.id);
      expect(detail).toMatchObject({
        status: 'actioned',
        actionTaken: 'quarantine',
        reviewedBy: { userId: moderator.userId },
      });
      expect(detail.cases.map((c) => [c.action, c.source])).toEqual([
        ['quarantine', 'security_event'],
      ]);
    });
  });

  describe('queries', () => {
    it('filters and paginates', async () => {
      await raise({ riskScore: 20 });
      await raise({ riskScore: 90, trigger: 'blocked_link' });
      const suspect = await kit.member();
      await recordSecurityEvent(kit.as(moderator), {
        targetUserId: suspect.userId,
        trigger: 'manual_report',
        riskScore: 10,
      });
      const all = await listSecurityEvents(kit.as(moderator), { limit: 2 });
      expect(all.total).toBe(3);
      expect(all.items).toHaveLength(2);
      expect(all.items[0]?.trigger).toBe('manual_report');
      const high = await listSecurityEvents(kit.as(moderator), { minRiskScore: 50 });
      expect(high.items.map((e) => e.riskScore)).toEqual([90]);
      const manual = await listSecurityEvents(kit.as(moderator), { source: 'manual' });
      expect(manual.total).toBe(1);
      const open = await listSecurityEvents(kit.as(moderator), { status: ['open'] });
      expect(open.total).toBe(3);
    });

    it('builds the alert card with every field', async () => {
      const view = await raise({ riskScore: 90 });
      const card = await getSecurityAlertCard(kit.system, view.id);
      expect(card.title).toBe('SECURITY EVENT SEC-0001 — FOREIGN INVITE');
      expect(card.severity).toBe('critical');
      expect(card.actionable).toBe(true);
      expect(card.subjectDiscordId).toBe(PROFILE.discordId);
      expect(card.fields.map((f) => f.label)).toEqual([
        'USER',
        'RISK SCORE',
        'TRIGGER',
        'EVIDENCE',
        'ACTION',
        'MODERATOR',
        'TIMESTAMP',
      ]);
      expect(card.fields.find((f) => f.label === 'MODERATOR')?.value).toBe('AUTOMOD');
      expect(card.fields.find((f) => f.label === 'EVIDENCE')?.value).toContain('discord.gg/abc');
    });
  });
});
