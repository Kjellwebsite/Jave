import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, modCases, securityEvents, users } from '@jave/database';
import { getSettings, moderation, updateSettings } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { InteractionUser } from '../../interactions/types';
import { RecentMessageWindow, recentWindowFor } from './listeners';
import {
  ALERT_CHANNEL_ID,
  CHAT_CHANNEL_ID,
  configureModeration,
  incomingMessage,
  QUARANTINE_ROLE_ID,
  snowflakeAt,
} from './test-support';

const DAY_MS = 86_400_000;
const OLD_ACCOUNT = new Date('2020-01-01T00:00:00.000Z');

function discordAccount(
  username: string,
  created: Date,
  avatar: string | null = 'a1b2c3',
): InteractionUser {
  return { id: snowflakeAt(created), username, globalName: username, avatar, bot: false };
}

describe('moderation feature — automod and join screening', () => {
  let bot: BotHarness;

  beforeEach(async () => {
    bot = await createBotHarness();
    await configureModeration(bot);
  });
  afterEach(async () => {
    await bot.close();
  });

  const post = async (author: InteractionUser, content: string, extra = {}) => {
    const message = incomingMessage(author, content, extra, bot.kit.clock.now());
    await bot.app.events.message(message);
    await bot.settle();
    return message;
  };
  const events = () => bot.kit.db.select().from(securityEvents);

  describe('automod', () => {
    it('lets ordinary messages through without recording anything', async () => {
      const author = discordAccount('ada', OLD_ACCOUNT);
      await post(author, 'shipping the compiler tonight, see readme.md');
      await post(author, 'benchmarks in index.ts look good');
      expect(await events()).toHaveLength(0);
      expect(bot.gateway.calls).toHaveLength(0);
      // Clean traffic never reaches the database: the author was not even synced.
      expect(
        await bot.kit.db.select().from(users).where(eq(users.discordId, author.id)),
      ).toHaveLength(0);
      expect(recentWindowFor(bot.app.services).trackedAuthors).toBe(1);
    });

    it('deletes a foreign invite from an established account', async () => {
      const author = discordAccount('promo', OLD_ACCOUNT);
      const message = await post(author, 'join us discord.gg/elsewhere');
      const [event] = await events();
      expect(event).toMatchObject({
        trigger: 'foreign_invite',
        source: 'automod',
        actionTaken: 'message_deleted',
        riskScore: 45,
      });
      expect(bot.gateway.callsTo('deleteMessage')[0]?.args.slice(0, 2)).toEqual([
        CHAT_CHANNEL_ID,
        message.id,
      ]);
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
      // The staff alert card was posted.
      expect(bot.gateway.callsTo('sendMessage')[0]?.args[0]).toBe(ALERT_CHANNEL_ID);
    });

    it('times out the same invite from a day-old account, in Discord', async () => {
      const author = discordAccount('fresh', new Date(bot.kit.clock.now().getTime() - DAY_MS / 2));
      bot.gateway.addMember(author.id, author.username);
      await post(author, 'free stuff discord.gg/elsewhere');
      const [record] = await bot.kit.db.select().from(modCases);
      expect(record).toMatchObject({ action: 'timeout', source: 'automod', moderatorUserId: null });
      expect(record?.discordSync).toBe('applied');
      expect(bot.gateway.members.get(author.id)?.timedOutUntil).not.toBeNull();
    });

    it('quarantines the classic raid-bot message', async () => {
      const author = discordAccount('raidbot', bot.kit.clock.now(), null);
      bot.gateway.addMember(author.id, author.username);
      await post(author, '@everyone FREE NITRO discord.gg/raid', { mentionCount: 8 });
      const [record] = await bot.kit.db.select().from(modCases);
      expect(record?.action).toBe('quarantine');
      expect(bot.gateway.members.get(author.id)?.roleIds).toContain(QUARANTINE_ROLE_ID);
    });

    it('catches a spam burst using the per-process recent-message window', async () => {
      const author = discordAccount('flood', OLD_ACCOUNT);
      bot.gateway.addMember(author.id, author.username);
      for (let i = 1; i <= 7; i++) await post(author, `update number ${i}`);
      expect(await events()).toHaveLength(0);
      await post(author, 'update number 8');
      const [event] = await events();
      expect(event?.trigger).toBe('spam_rate');
      const [record] = await bot.kit.db.select().from(modCases);
      expect(record?.action).toBe('timeout');
    });

    it('catches repeated identical messages', async () => {
      const author = discordAccount('echo', OLD_ACCOUNT);
      for (let i = 0; i < 4; i++) await post(author, 'check my channel out now');
      const [event] = await events();
      expect(event?.trigger).toBe('duplicate_content');
    });

    it('exempts by JAVE role, never by Discord role', async () => {
      const mod = await bot.member({ roles: ['moderator'] });
      await post(mod.user, 'partner server: discord.gg/partner');
      expect(await events()).toHaveLength(0);

      const member = await bot.member();
      await post(member.user, 'discord.gg/elsewhere', {
        authorRoleIds: ['999999999999999999'],
      });
      expect(await events()).toHaveLength(1);
    });

    it('ignores bots, DMs and other guilds', async () => {
      const author = discordAccount('spam', OLD_ACCOUNT);
      await post({ ...author, bot: true }, 'discord.gg/elsewhere');
      await post(author, 'discord.gg/elsewhere', { guildId: null });
      await post(author, 'discord.gg/elsewhere', { guildId: '123456789012345678' });
      expect(await events()).toHaveLength(0);
    });

    it('BREAK: survives odd input without crashing or false positives', async () => {
      const author = discordAccount('   ', OLD_ACCOUNT);
      const odd = [
        { content: '' },
        { content: '​​‮⁦' },
        { content: '🧪'.repeat(3000) },
        { content: 'x'.repeat(100_000) },
        { content: 'normal', mentionCount: Number.NaN },
        { content: 'normal', mentionCount: -5 },
        { content: 'normal', mentionCount: Number.POSITIVE_INFINITY },
      ];
      for (const extra of odd) {
        await expect(
          bot.app.events.message(
            incomingMessage(author, extra.content, extra, bot.kit.clock.now()),
          ),
        ).resolves.toBeUndefined();
      }
      await expect(
        bot.app.events.message(
          incomingMessage({ ...author, id: 'not-a-snowflake' }, 'discord.gg/x'),
        ),
      ).resolves.toBeUndefined();
      await bot.settle();
      // Oversized content is truncated and scanned; non-finite counts read as zero.
      expect(await events()).toHaveLength(0);
    });

    it('does not act twice on a redelivered message', async () => {
      const author = discordAccount('promo', OLD_ACCOUNT);
      const message = incomingMessage(author, 'discord.gg/elsewhere', {}, bot.kit.clock.now());
      await bot.app.events.message(message);
      await bot.app.events.message(message);
      await bot.settle();
      expect(await events()).toHaveLength(1);
      expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(1);
    });
  });

  describe('RecentMessageWindow', () => {
    const at = (ms: number) => new Date(Date.UTC(2026, 2, 1) + ms);

    it('returns only earlier messages inside the horizon', () => {
      const window = new RecentMessageWindow();
      window.recordAndGet('a', { content: 'one', at: at(0) }, 10_000);
      window.recordAndGet('a', { content: 'two', at: at(5_000) }, 10_000);
      const earlier = window.recordAndGet('a', { content: 'three', at: at(12_000) }, 10_000);
      expect(earlier.map((m) => m.content)).toEqual(['two']);
    });

    it('bounds memory per author and in total', () => {
      const window = new RecentMessageWindow(3, 5);
      for (let i = 0; i < 20; i++) window.recordAndGet('a', { content: `${i}`, at: at(i) }, 60_000);
      expect(window.recordAndGet('a', { content: 'x', at: at(21) }, 60_000)).toHaveLength(5);
      for (const author of ['b', 'c', 'd'])
        window.recordAndGet(author, { content: '-', at: at(22) }, 60_000);
      expect(window.trackedAuthors).toBe(3);
      // 'a' was the least recently active and was forgotten.
      expect(window.recordAndGet('a', { content: 'y', at: at(23) }, 60_000)).toHaveLength(0);
    });
  });

  describe('join screening', () => {
    const joinOf = (account: InteractionUser) => ({
      id: account.id,
      username: account.username,
      globalName: account.globalName,
      avatar: account.avatar,
      bot: false,
      joinedAt: bot.kit.clock.now(),
    });

    const join = async (account: InteractionUser) => {
      bot.gateway.addMember(account.id, account.username);
      await bot.app.events.memberJoin(joinOf(account));
      await bot.settle();
    };

    it('lets ordinary joins through and records suspicious ones', async () => {
      await join(discordAccount('ada', OLD_ACCOUNT));
      expect(await events()).toHaveLength(0);
      await join(discordAccount('newbie', bot.kit.clock.now()));
      const [event] = await events();
      expect(event).toMatchObject({ trigger: 'suspicious_account', actionTaken: 'flagged' });
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
    });

    it('quarantines suspicious joins when configured', async () => {
      await updateSettings(bot.kit.system, 'security', { quarantineSuspiciousJoins: true });
      const account = discordAccount('newbie', bot.kit.clock.now(), null);
      await join(account);
      const [record] = await bot.kit.db.select().from(modCases);
      expect(record).toMatchObject({ action: 'quarantine', discordSync: 'applied' });
      expect(bot.gateway.members.get(account.id)?.roleIds).toContain(QUARANTINE_ROLE_ID);
    });

    it('detects a raid, switches raid mode on automatically and holds new joins', async () => {
      const accounts = Array.from({ length: 11 }, (_, i) =>
        discordAccount(`raider${i}`, OLD_ACCOUNT),
      );
      for (const account of accounts) {
        await join(account);
        bot.kit.clock.advance(1000);
      }
      expect((await getSettings(bot.kit.system, 'security')).raidMode).toBe(true);
      const notices = bot.gateway
        .callsTo('sendMessage')
        .filter((c) => c.args[0] === ALERT_CHANNEL_ID)
        .map((c) => (c.args[1] as { embeds: { title: string }[] }).embeds[0]!.title);
      expect(notices).toContain('RAID MODE — ON');
      const held = await bot.kit.db
        .select()
        .from(modCases)
        .where(eq(modCases.action, 'quarantine'));
      expect(held).toHaveLength(2);
      for (const account of accounts.slice(9)) {
        expect(bot.gateway.members.get(account.id)?.roleIds).toContain(QUARANTINE_ROLE_ID);
      }
      for (const account of accounts.slice(0, 9)) {
        expect(bot.gateway.members.get(account.id)?.roleIds).not.toContain(QUARANTINE_ROLE_ID);
      }
    });

    it('re-applies a live ban when a banned user rejoins', async () => {
      const core = await bot.member({ roles: ['core'] });
      const target = await bot.member({ username: 'returning' });
      await moderation.banMember(bot.kit.as(core.actor), {
        targetUserId: target.actor.userId,
        reason: 'Scam wave',
      });
      await bot.drain();
      expect(bot.gateway.callsTo('ban')).toHaveLength(1);
      await bot.app.events.memberLeave(target.user.id);
      await join(target.user);
      expect(bot.gateway.callsTo('ban')).toHaveLength(2);
      const [member] = await bot.kit.db
        .select()
        .from(members)
        .where(eq(members.id, target.actor.memberId!));
      expect(member?.standing).toBe('banned');
    });

    it('ignores bot accounts', async () => {
      const account = discordAccount('helper', bot.kit.clock.now());
      await bot.app.events.memberJoin({ ...joinOf(account), bot: true });
      await bot.settle();
      expect(await events()).toHaveLength(0);
    });
  });
});
