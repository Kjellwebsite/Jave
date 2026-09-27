import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, securityEvents } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { listCases } from './cases.query';
import { addModNote, warnMember } from './cases.service';
import { MESSAGE_REPORT_LIMIT } from './constants';
import { DISCORD_MODERATION_ALERT_JOB } from './discord-jobs';
import { reportMessage } from './reports.service';
import { getSecurityEvent } from './security.query';
import {
  auditsOf,
  configureModeration,
  INTEGRATION_TIMEOUTS,
  jobsOfType,
  MESSAGE_CHANNEL_ID,
  notificationsFor,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

let messageCounter = 330_000_000_000_000_000n;
const nextMessageId = () => (++messageCounter).toString();

describe('member message reports', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let reporter: UserActor;
  let author: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    reporter = await kit.member({ roles: ['member'], username: 'witness' });
    author = await kit.member({ roles: ['member'], username: 'scammer' });
  });
  afterEach(async () => {
    await kit.close();
  });

  const report = (actor: UserActor, overrides: Record<string, unknown> = {}) =>
    reportMessage(kit.as(actor), {
      authorDiscordId: author.discordId,
      channelId: MESSAGE_CHANNEL_ID,
      messageId: nextMessageId(),
      content:
        'free nitro at https://discord-gift.example ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      ...overrides,
    });

  it('records a manual report with a redacted excerpt, alerts staff and posts a card', async () => {
    const result = await report(reporter);
    expect(result.duplicate).toBe(false);
    const view = await getSecurityEvent(kit.as(moderator), result.securityEventId);
    expect(view).toMatchObject({
      trigger: 'manual_report',
      source: 'manual',
      status: 'open',
      actionTaken: 'none',
      riskScore: 0,
      user: { userId: author.userId },
      reportedBy: { userId: reporter.userId },
      channelId: MESSAGE_CHANNEL_ID,
    });
    expect(view.evidence.excerpt).toContain('free nitro');
    expect(view.evidence.excerpt).not.toContain('ghp_abcdefghij');
    const [alert] = await notificationsFor(kit, moderator.userId, 'security.alert');
    expect(alert?.title).toBe('SECURITY EVENT — MANUAL REPORT');
    expect(await notificationsFor(kit, reporter.userId, 'security.alert')).toHaveLength(0);
    expect(await jobsOfType(kit, DISCORD_MODERATION_ALERT_JOB)).toHaveLength(1);
  });

  it('raises one event per message however many members report it', async () => {
    const messageId = nextMessageId();
    const first = await report(reporter, { messageId });
    const second = await report(moderator, { messageId });
    expect(second).toEqual({ securityEventId: first.securityEventId, duplicate: true });
    expect(await kit.db.select().from(securityEvents)).toHaveLength(1);
    expect(await jobsOfType(kit, DISCORD_MODERATION_ALERT_JOB)).toHaveLength(1);
  });

  it('BREAK: rate limits each reporter so reports cannot flood staff', async () => {
    for (let i = 0; i < MESSAGE_REPORT_LIMIT; i++) await report(reporter);
    await expect(report(reporter)).rejects.toBeInstanceOf(RateLimitedError);
    // Another reporter is unaffected.
    await expect(report(moderator)).resolves.toMatchObject({ duplicate: false });
  });

  it('BREAK: refuses self-reports, restricted reporters and anonymous callers', async () => {
    await expect(report(author)).rejects.toBeInstanceOf(ValidationError);
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, reporter.memberId!));
    await expect(report({ ...reporter, standing: 'quarantined' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await auditsOf(kit, 'access.denied')).toHaveLength(1);
    await expect(
      reportMessage(kit.as({ kind: 'anonymous' }), {
        authorDiscordId: author.discordId,
        channelId: MESSAGE_CHANNEL_ID,
        messageId: nextMessageId(),
      }),
    ).rejects.toThrow();
  });

  it('BREAK: a report can never suppress an automated detection of the same message', async () => {
    const messageId = nextMessageId();
    await report(reporter, { messageId });
    const [event] = await kit.db.select().from(securityEvents);
    expect(event?.dedupeKey).toBe(`report:${messageId}`);
    expect(event?.dedupeKey?.startsWith('automod:')).toBe(false);
  });

  it('BREAK: a report about a staff member reaches only staff who may read it', async () => {
    const operations = await kit.member({ roles: ['operations'], username: 'ops' });
    const core = await kit.member({ roles: ['core'], username: 'core' });
    const founder = await kit.member({ roles: ['founder'], username: 'founder' });
    const result = await report(reporter, { authorDiscordId: operations.discordId });
    // No card in the shared alerts channel, where every moderator would read it.
    expect(await jobsOfType(kit, DISCORD_MODERATION_ALERT_JOB)).toHaveLength(0);
    expect(await notificationsFor(kit, moderator.userId, 'security.alert')).toHaveLength(0);
    expect(await notificationsFor(kit, operations.userId, 'security.alert')).toHaveLength(0);
    expect(await notificationsFor(kit, core.userId, 'security.alert')).toHaveLength(1);
    expect(await notificationsFor(kit, founder.userId, 'security.alert')).toHaveLength(1);
    await expect(
      getSecurityEvent(kit.as(moderator), result.securityEventId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSecurityEvent(kit.as(core), result.securityEventId)).resolves.toMatchObject({
      user: { userId: operations.userId },
    });
  });

  it('BREAK: rejects malformed ids and oversized content', async () => {
    await expect(report(reporter, { messageId: 'not-a-snowflake' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(report(reporter, { content: 'x'.repeat(20_000) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('listCases by number', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  it('finds a case by its number and respects subject visibility', async () => {
    const moderator = await kit.member({ roles: ['moderator'] });
    const target = await kit.member({ roles: ['member'] });
    await addModNote(kit.as(moderator), { targetUserId: target.userId, reason: 'first note' });
    const warned = await warnMember(kit.as(moderator), {
      targetUserId: target.userId,
      reason: 'second',
    });
    const page = await listCases(kit.as(moderator), { number: warned.number });
    expect(page.items.map((item) => item.id)).toEqual([warned.id]);
    expect(page.total).toBe(1);

    // A case about the moderator themself stays hidden, even by number.
    const core = await kit.member({ roles: ['core'] });
    const aboutModerator = await addModNote(kit.as(core), {
      targetUserId: moderator.userId,
      reason: 'staff note',
    });
    const hidden = await listCases(kit.as(moderator), { number: aboutModerator.number });
    expect(hidden.total).toBe(0);
    expect((await listCases(kit.as(core), { number: aboutModerator.number })).total).toBe(1);

    await expect(listCases(kit.as(target), { number: warned.number })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listCases(kit.as(moderator), { number: -1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
