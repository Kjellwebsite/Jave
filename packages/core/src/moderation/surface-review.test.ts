import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, modCases, securityEvents } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { syncDiscordUser } from '../identity/users.service';
import { InvalidStateError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { isRiskScored, UNSCORED_RISK_SCORE } from './alerts';
import { applyAutomodDecision } from './automod.service';
import { discordStateOf, getCase, getCaseHistory } from './cases.query';
import {
  addModNote,
  banMember,
  kickMember,
  quarantineMember,
  revokeCase,
  timeoutMember,
  warnMember,
} from './cases.service';
import { DISCORD_MODERATION_DELETE_MESSAGES_JOB } from './discord-jobs';
import { screenJoin, setRaidMode } from './raid.service';
import { reportMessage } from './reports.service';
import { getSecurityAlertCard, getSecurityEvent } from './security.query';
import { reviewSecurityEvent } from './security.service';
import { BOT_TARGET_MESSAGE, botTargetViolation } from './targets';
import {
  configureModeration,
  INTEGRATION_TIMEOUTS,
  jobsOfType,
  MESSAGE_CHANNEL_ID,
  notificationsFor,
} from './test-support';

vi.setConfig(INTEGRATION_TIMEOUTS);

let idCounter = 360_000_000_000_000_000n;
const nextId = () => (++idCounter).toString();
const REASON = 'Posting scam links in #general.';

describe('moderation surface review fixes', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let core: UserActor;
  let reporter: UserActor;
  let author: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    await configureModeration(kit);
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    core = await kit.member({ roles: ['core'], username: 'core' });
    reporter = await kit.member({ roles: ['member'], username: 'witness' });
    author = await kit.member({ roles: ['member'], username: 'scammer' });
  });
  afterEach(async () => {
    await kit.close();
  });

  /** A bot account that some surface synced as a member (the state before the fix). */
  async function botMember(username = 'jave-bot') {
    const discordId = nextId();
    const { user } = await syncDiscordUser(
      kit.system,
      { discordId, username, isBot: true },
      { inGuild: true },
    );
    return { userId: user.id, discordId };
  }

  describe('bot and webhook accounts', () => {
    it('BREAK: refuses every punitive action on a bot, regardless of the caller rank', async () => {
      const bot = await botMember();
      const ctx = kit.as(core);
      const attempts = [
        () => warnMember(ctx, { targetDiscordId: bot.discordId, reason: REASON }),
        () =>
          timeoutMember(ctx, {
            targetDiscordId: bot.discordId,
            reason: REASON,
            durationSeconds: 600,
          }),
        () => kickMember(ctx, { targetDiscordId: bot.discordId, reason: REASON }),
        () => banMember(ctx, { targetDiscordId: bot.discordId, reason: REASON }),
        () => quarantineMember(ctx, { targetDiscordId: bot.discordId, reason: REASON }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow(InvalidStateError);
        await expect(attempt()).rejects.toThrow(BOT_TARGET_MESSAGE);
      }
      expect(await kit.db.select().from(modCases)).toHaveLength(0);
      const [member] = await kit.db
        .select({ standing: members.standing })
        .from(members)
        .where(eq(members.userId, bot.userId));
      expect(member?.standing).toBe('good');
    });

    it('still allows a private note about a bot (not punitive)', async () => {
      const bot = await botMember();
      const note = await addModNote(kit.as(moderator), {
        targetDiscordId: bot.discordId,
        reason: 'Integration posted a malformed embed; owner informed.',
      });
      expect(note).toMatchObject({ action: 'note', discordSync: 'not_required' });
      const history = await getCaseHistory(kit.as(moderator), { targetDiscordId: bot.discordId });
      expect(history.isBot).toBe(true);
      expect(
        (await getCaseHistory(kit.as(moderator), { targetDiscordId: author.discordId })).isBot,
      ).toBe(false);
    });

    it('the pure rule refuses punitive actions only, and only for bots', () => {
      for (const action of ['warn', 'timeout', 'kick', 'ban', 'quarantine'] as const) {
        expect(botTargetViolation({ isBot: true }, action)).toBe(BOT_TARGET_MESSAGE);
        expect(botTargetViolation({ isBot: false }, action)).toBeNull();
      }
      for (const action of ['untimeout', 'unban', 'release', 'note'] as const) {
        expect(botTargetViolation({ isBot: true }, action)).toBeNull();
      }
    });

    it('automod flags a bot author for review: no deletion, no case', async () => {
      const bot = await botMember('relay-bot');
      const outcome = await applyAutomodDecision(kit.system, {
        discordUser: { discordId: bot.discordId, username: 'relay-bot', isBot: true },
        evaluation: {
          signals: [{ key: 'foreign_invite', weight: 45 }],
          riskScore: 95,
          action: 'quarantine',
          trigger: 'foreign_invite',
        },
        channelId: MESSAGE_CHANNEL_ID,
        messageIds: [nextId()],
      });
      expect(outcome).toMatchObject({ applied: 'flagged', caseId: null });
      expect(await jobsOfType(kit, DISCORD_MODERATION_DELETE_MESSAGES_JOB)).toHaveLength(0);
      expect(await kit.db.select().from(modCases)).toHaveLength(0);
    });

    it('raid mode never holds a joining bot', async () => {
      await setRaidMode(kit.as(core), { enabled: true, reason: 'Invite leaked publicly.' });
      const discordId = nextId();
      const result = await screenJoin(kit.system, {
        discordUser: { discordId, username: 'music-bot', isBot: true },
      });
      expect(result.caseId).toBeNull();
      expect(await kit.db.select().from(modCases)).toHaveLength(0);
    });

    it('a report about a bot message is recorded, but its card never offers QUARANTINE', async () => {
      const bot = await botMember('giveaway-bot');
      const result = await reportMessage(kit.as(reporter), {
        authorDiscordId: bot.discordId,
        channelId: MESSAGE_CHANNEL_ID,
        messageId: nextId(),
        content: 'Claim your prize at https://discord-gift.example',
      });
      const card = await getSecurityAlertCard(kit.system, result.securityEventId);
      expect(card.subjectDiscordId).toBe(bot.discordId);
      expect(card.quarantineOffered).toBe(false);
    });
  });

  describe('member reports on the alert card', () => {
    const fieldOf = (card: { fields: { label: string; value: string }[] }, label: string) =>
      card.fields.find((f) => f.label === label)?.value;

    it('never names the reporter, and reads NOT SCORED instead of low risk', async () => {
      const result = await reportMessage(kit.as(reporter), {
        authorDiscordId: author.discordId,
        channelId: MESSAGE_CHANNEL_ID,
        messageId: nextId(),
        content: 'free nitro https://discord-gift.example',
      });
      const card = await getSecurityAlertCard(kit.system, result.securityEventId);
      const text = JSON.stringify(card);
      expect(text).not.toContain(reporter.discordId);
      expect(text).not.toContain('witness');
      expect(fieldOf(card, 'MODERATOR')).toBe('— awaiting review');
      expect(fieldOf(card, 'RISK SCORE')).toBe('NOT SCORED · staff judgement');
      expect(card.severity).toBe('unscored');
      expect(card.quarantineOffered).toBe(true);

      // Staff still see who reported it on the dashboard read model.
      const view = await getSecurityEvent(kit.as(moderator), result.securityEventId);
      expect(view).toMatchObject({ riskScored: false, reportedBy: { userId: reporter.userId } });

      // The staff alert does not claim a 0/100 risk either.
      const [alert] = await notificationsFor(kit, moderator.userId, 'security.alert');
      expect(alert?.body).toContain('not scored');
      expect(alert?.body).not.toContain('0/100');
    });

    it('names the reviewer (never the reporter) once reviewed', async () => {
      const result = await reportMessage(kit.as(reporter), {
        authorDiscordId: author.discordId,
        channelId: MESSAGE_CHANNEL_ID,
        messageId: nextId(),
        content: 'dm me for cheap accounts',
      });
      await reviewSecurityEvent(kit.as(moderator), {
        securityEventId: result.securityEventId,
        status: 'acknowledged',
      });
      const card = await getSecurityAlertCard(kit.system, result.securityEventId);
      expect(fieldOf(card, 'MODERATOR')).toBe(`mod (${moderator.discordId})`);
      expect(JSON.stringify(card)).not.toContain(reporter.discordId);
    });

    it('scores automated events as before', async () => {
      const [row] = await kit.db
        .insert(securityEvents)
        .values({
          userId: author.userId,
          trigger: 'foreign_invite',
          riskScore: 45,
          source: 'automod',
          evidence: { signals: [{ key: 'foreign_invite', weight: 45 }] },
          actionTaken: 'message_deleted',
        })
        .returning();
      const card = await getSecurityAlertCard(kit.system, row!.id);
      expect(card.severity).toBe('low');
      expect(fieldOf(card, 'RISK SCORE')).toBe('45/100');
      expect(fieldOf(card, 'MODERATOR')).toBe('AUTOMOD');
      expect(isRiskScored({ trigger: 'manual_report', riskScore: 40 })).toBe(true);
      expect(isRiskScored({ trigger: 'manual_report', riskScore: UNSCORED_RISK_SCORE })).toBe(
        false,
      );
      expect(isRiskScored({ trigger: 'spam_rate', riskScore: 0 })).toBe(true);
    });
  });

  describe('Discord state of cases that ended before the bot applied them', () => {
    it('reads not_applied (not pending) once a queued quarantine is revoked', async () => {
      const quarantine = await quarantineMember(kit.as(moderator), {
        targetUserId: author.userId,
        reason: REASON,
      });
      expect(quarantine.discordState).toBe('pending');
      const { reversal } = await revokeCase(kit.as(moderator), {
        caseId: quarantine.id,
        reason: 'Account recovered by its owner.',
      });
      const revoked = await getCase(kit.as(moderator), quarantine.id);
      expect(revoked).toMatchObject({ discordSync: 'pending', discordState: 'not_applied' });
      // The reversal still has to reach Discord.
      expect(reversal?.discordState).toBe('pending');
    });

    it('reads not_applied for a superseded timeout, and keeps real outcomes', () => {
      const base = { endedAt: null, revokedAt: null } as const;
      const ended = new Date('2026-03-01T12:00:00Z');
      expect(discordStateOf({ ...base, action: 'timeout', discordSync: 'pending' })).toBe(
        'pending',
      );
      expect(
        discordStateOf({ ...base, action: 'timeout', discordSync: 'pending', endedAt: ended }),
      ).toBe('not_applied');
      expect(
        discordStateOf({ ...base, action: 'ban', discordSync: 'applied', endedAt: ended }),
      ).toBe('applied');
      expect(
        discordStateOf({ ...base, action: 'quarantine', discordSync: 'failed', endedAt: ended }),
      ).toBe('failed');
      // A revoked warning is still delivered (only live actions are skipped).
      expect(
        discordStateOf({ ...base, action: 'warn', discordSync: 'pending', revokedAt: ended }),
      ).toBe('pending');
    });
  });
});
