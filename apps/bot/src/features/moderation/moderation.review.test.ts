import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, modCases, securityEvents, users } from '@jave/database';
import { moderation, updateSettings } from '@jave/core';
import type { APIEmbed } from 'discord.js';
import { DiscordActionError } from '../../discord/gateway';
import type { MessageUpdate } from '../../gateway-events/types';
import type { InteractionUser } from '../../interactions/types';
import type { FakeInteractionInit } from '../../testing/fake-interaction';
import { createBotHarness, type BotHarness, TEST_GUILD_ID } from '../../testing/harness';
import { COLORS } from '../../ui/theme';
import {
  ALERT_CHANNEL_ID,
  CHAT_CHANNEL_ID,
  configureModeration,
  customIdsOf,
  incomingMessage,
  modalOf,
  selectOptions,
  snowflakeAt,
  targetMessage,
} from './test-support';

const INTERACTION_GAP_MS = 1000;
const DAY_MS = 86_400_000;
const OLD_ACCOUNT = new Date('2020-01-01T00:00:00.000Z');
const SERVICE_UNAVAILABLE = 503;

/** Fixes from the moderation surface review: bots, report cards, edits, Discord state. */
describe('moderation feature — review fixes', () => {
  let bot: BotHarness;

  beforeEach(async () => {
    bot = await createBotHarness();
    await configureModeration(bot);
  });
  afterEach(async () => {
    await bot.close();
  });

  const run = (init: Omit<FakeInteractionInit, 'user'> & { user: InteractionUser }) => {
    bot.kit.clock.advance(INTERACTION_GAP_MS);
    return bot.run(init);
  };
  const staff = (role: 'moderator' | 'core' = 'moderator') =>
    bot.member({ roles: [role], username: `${role}-${Math.random().toString(36).slice(2, 7)}` });

  /** A bot account present in the server, as Discord resolves it in an interaction. */
  function discordBot(username = 'jave'): InteractionUser {
    const user = {
      id: snowflakeAt(OLD_ACCOUNT),
      username,
      globalName: null,
      avatar: null,
      bot: true,
    };
    bot.gateway.addMember(user.id, username);
    return user;
  }
  const userRow = async (discordId: string) =>
    (await bot.kit.db.select().from(users).where(eq(users.discordId, discordId)))[0];
  const memberRowsOf = async (userId: string) =>
    bot.kit.db.select().from(members).where(eq(members.userId, userId));

  describe('BREAK: bot and webhook accounts are never moderation targets', () => {
    it('/mod quarantine on the JAVE bot is refused before any record or Discord call', async () => {
      const mod = await staff('core');
      const target = discordBot();
      const { interaction } = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'quarantine',
        user: mod.user,
        options: { member: target, reason: 'Testing the quarantine role' },
      });
      expect(interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);
      expect(interaction.lastPayload()?.ephemeral).toBe(true);
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
      expect(await userRow(target.id)).toBeUndefined();
      expect(bot.gateway.callsTo('addRoles')).toHaveLength(0);
    });

    it('/mod warn, timeout, kick and ban on a bot are refused without opening a form', async () => {
      const mod = await staff('core');
      const target = discordBot('relay');
      for (const subcommand of ['warn', 'timeout', 'kick', 'ban']) {
        const { interaction } = await run({
          kind: 'slash',
          name: 'mod',
          subcommand,
          user: mod.user,
          options: { member: target },
        });
        expect(modalOf(interaction.responses)).toBeNull();
        expect(interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);
      }
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
      expect(bot.gateway.calls).toHaveLength(0);
    });

    it('the Quarantine context menu refuses a bot', async () => {
      const mod = await staff();
      const target = discordBot('music');
      const { interaction } = await run({
        kind: 'user_context',
        name: 'Quarantine',
        user: mod.user,
        targetUser: target,
      });
      expect(modalOf(interaction.responses)).toBeNull();
      expect(interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);
    });

    it('Delete & warn refuses bot posts (JAVE alert cards included) and webhook relays', async () => {
      const mod = await staff();
      const cardAuthor = discordBot('JAVE');
      const botPost = await run({
        kind: 'message_context',
        name: 'Delete & warn',
        user: mod.user,
        targetMessage: targetMessage(cardAuthor, 'SECURITY EVENT SEC-0001 — FOREIGN INVITE'),
      });
      expect(modalOf(botPost.interaction.responses)).toBeNull();
      expect(botPost.interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);

      // A webhook author is not guaranteed to carry the bot flag: the webhook id decides.
      const relay: InteractionUser = {
        id: snowflakeAt(OLD_ACCOUNT),
        username: 'GitHub',
        globalName: null,
        avatar: null,
        bot: false,
      };
      const webhookPost = await run({
        kind: 'message_context',
        name: 'Delete & warn',
        user: mod.user,
        targetMessage: {
          ...targetMessage(relay, '[jave] 3 new commits pushed to main'),
          webhookId: relay.id,
        },
      });
      expect(modalOf(webhookPost.interaction.responses)).toBeNull();
      expect(webhookPost.interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);
      expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(0);
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
    });

    it('history of a bot creates no member and offers no punitive action', async () => {
      const mod = await staff('core');
      const target = discordBot('ci');
      const { interaction } = await run({
        kind: 'user_context',
        name: 'Moderation history',
        user: mod.user,
        targetUser: target,
      });
      expect(interaction.lastText()).toContain('BOT ACCOUNT');
      const row = await userRow(target.id);
      expect(row?.isBot).toBe(true);
      expect(await memberRowsOf(row!.id)).toHaveLength(0);
      const actions = selectOptions(interaction.lastPayload(), 'moderation:act:').map(
        (o) => o.value,
      );
      expect(actions).toEqual(['note']);
    });

    it('a forged "Take action" pick on a bot is refused by core', async () => {
      const mod = await staff('core');
      const target = discordBot('ci');
      await run({
        kind: 'user_context',
        name: 'Moderation history',
        user: mod.user,
        targetUser: target,
      });
      const open = await run({
        kind: 'select',
        name: `moderation:act:${target.id}`,
        user: mod.user,
        values: ['kick'],
      });
      const modal = modalOf(open.interaction.responses);
      const submit = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Forged kick of a bot' },
      });
      const [confirmId] = customIdsOf(submit.interaction.lastPayload());
      const confirm = await run({ kind: 'button', name: confirmId!, user: mod.user });
      expect(confirm.interaction.lastText()).toContain(moderation.BOT_TARGET_MESSAGE);
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(0);
      expect(bot.gateway.callsTo('kick')).toHaveLength(0);
    });
  });

  describe('member report cards in the shared alerts channel', () => {
    const cardEmbed = () => {
      const [post] = bot.gateway.callsTo('sendMessage');
      expect(post?.args[0]).toBe(ALERT_CHANNEL_ID);
      return (post?.args[1] as { embeds: APIEmbed[] }).embeds[0]!;
    };
    const fieldValue = (embed: APIEmbed, name: string) =>
      embed.fields?.find((f) => f.name === name)?.value ?? '';

    it('never names the reporting member, and reads NOT SCORED in a neutral tone', async () => {
      const reporter = await bot.member({ username: 'witness' });
      const author = await bot.member({ username: 'phisher' });
      await run({
        kind: 'message_context',
        name: 'Report message',
        user: reporter.user,
        targetMessage: targetMessage(author.user, 'claim nitro at discord-gift.example'),
      });
      const embed = cardEmbed();
      const text = JSON.stringify(embed);
      expect(text).not.toContain(reporter.user.id);
      expect(text).not.toContain('witness');
      expect(fieldValue(embed, 'MODERATOR')).toContain('awaiting review');
      expect(fieldValue(embed, 'RISK SCORE')).toContain('NOT SCORED');
      expect(fieldValue(embed, 'RISK SCORE')).not.toContain('0/100');
      expect(embed.author?.name ?? '').toContain('NOT SCORED');
      expect(embed.color).toBe(COLORS.info);
    });

    it('a report about a bot message never offers QUARANTINE', async () => {
      const reporter = await bot.member();
      const giveaway = discordBot('giveaway');
      await run({
        kind: 'message_context',
        name: 'Report message',
        user: reporter.user,
        targetMessage: targetMessage(giveaway, 'You won! Claim at discord-gift.example'),
      });
      const [event] = await bot.kit.db.select().from(securityEvents);
      const [post] = bot.gateway.callsTo('sendMessage');
      expect(customIdsOf(post?.args[1] as { components?: unknown[] })).toEqual([
        `moderation:sec-ack:${event!.id}`,
        `moderation:sec-dismiss:${event!.id}`,
      ]);
    });
  });

  describe('automod on edited messages', () => {
    const edit = async (
      author: InteractionUser,
      messageId: string,
      content: string,
      extra: Partial<MessageUpdate> = {},
    ) => {
      await bot.app.events.messageUpdate({
        id: messageId,
        channelId: CHAT_CHANNEL_ID,
        guildId: TEST_GUILD_ID,
        content,
        editedAt: bot.kit.clock.now(),
        author,
        webhookId: null,
        contentEdited: true,
        mentionCount: 0,
        mentionsEveryone: false,
        ...extra,
      });
      await bot.settle();
    };
    const events = () => bot.kit.db.select().from(securityEvents);

    it('BREAK: post harmless text, then edit in a raid invite — screened and acted on', async () => {
      const author: InteractionUser = {
        id: snowflakeAt(new Date(bot.kit.clock.now().getTime() - DAY_MS / 2)),
        username: 'raider',
        globalName: null,
        avatar: null,
        bot: false,
      };
      bot.gateway.addMember(author.id, author.username);
      const message = incomingMessage(author, 'hi', {}, bot.kit.clock.now());
      await bot.app.events.message(message);
      await bot.settle();
      expect(await events()).toHaveLength(0);

      bot.kit.clock.advance(INTERACTION_GAP_MS);
      await edit(author, message.id, 'free nitro discord.gg/raidhub @everyone');
      const [event] = await events();
      expect(event).toMatchObject({ trigger: 'foreign_invite', source: 'automod' });
      expect(bot.gateway.callsTo('deleteMessage')[0]?.args.slice(0, 2)).toEqual([
        CHAT_CHANNEL_ID,
        message.id,
      ]);
      const [record] = await bot.kit.db.select().from(modCases);
      expect(record?.source).toBe('automod');

      // Editing again (or Discord re-sending the update) never actions the message twice.
      await edit(author, message.id, 'free nitro discord.gg/raidhub @everyone @here');
      expect(await events()).toHaveLength(1);
      expect(await bot.kit.db.select().from(modCases)).toHaveLength(1);
    });

    it('ignores embed unfurls, clean edits, webhook posts and author-less updates', async () => {
      const author: InteractionUser = {
        id: snowflakeAt(OLD_ACCOUNT),
        username: 'ada',
        globalName: null,
        avatar: null,
        bot: false,
      };
      const id = snowflakeAt(bot.kit.clock.now());
      await edit(author, id, 'join discord.gg/elsewhere', { contentEdited: false });
      await edit(author, id, 'fixed a typo in the changelog');
      await edit(author, id, 'join discord.gg/elsewhere', { webhookId: author.id });
      await bot.app.events.messageUpdate({
        id,
        channelId: CHAT_CHANNEL_ID,
        guildId: TEST_GUILD_ID,
        content: 'join discord.gg/elsewhere',
        editedAt: bot.kit.clock.now(),
      });
      await edit({ ...author, bot: true }, id, 'join discord.gg/elsewhere');
      await edit(author, id, 'join discord.gg/elsewhere', { guildId: '100000000000000111' });
      await bot.settle();
      expect(await events()).toHaveLength(0);
      expect(bot.gateway.calls).toHaveLength(0);
      // Nothing reached the database: the author was never even synced.
      expect(await userRow(author.id)).toBeUndefined();
    });

    it('edits by staff are flagged for review, never actioned', async () => {
      const mod = await bot.member({ roles: ['moderator'] });
      // With no exempt roles staff messages are screened; staff are still never actioned.
      await updateSettings(bot.kit.system, 'moderation', { exemptRoles: [] });
      const id = snowflakeAt(bot.kit.clock.now());
      await edit(mod.user, id, 'partner server: discord.gg/partner');
      const [event] = await events();
      expect(event?.actionTaken).toBe('flagged');
      expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(0);
    });
  });

  describe('Discord state of a case that ended before the bot applied it', () => {
    it('/mod case shows NOT APPLIED instead of a pending sync', async () => {
      const mod = await staff();
      const target = await bot.member({ username: 'held' });
      // Discord is briefly unavailable: the apply job waits to retry.
      bot.gateway.failures.set(
        'addRoles',
        new DiscordActionError('Service Unavailable', SERVICE_UNAVAILABLE, false),
      );
      await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'quarantine',
        user: mod.user,
        options: { member: target.user, reason: 'Compromised account' },
      });
      const [quarantine] = await bot.kit.db.select().from(modCases);
      expect(quarantine?.discordSync).toBe('pending');
      await moderation.revokeCase(bot.kit.as(mod.actor), {
        caseId: quarantine!.id,
        reason: 'Owner recovered the account.',
      });
      await bot.drain();
      const { interaction } = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'case',
        user: mod.user,
        options: { case: quarantine!.id },
      });
      const text = interaction.lastText();
      expect(text).toContain('NOT APPLIED');
      expect(text).not.toContain('PENDING');
    });
  });
});
