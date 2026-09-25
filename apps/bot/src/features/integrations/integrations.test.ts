import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  externalAccounts,
  integrations as integrationsTable,
  jobs,
  webhookDeliveries,
} from '@jave/database';
import { anonymousActor, enqueueJob, integrations, type UserActor } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { buttonLabels } from '../projects/testing';

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

const RELAY_CHANNEL = '400000000000000001';
const RETRY_DELAY_MS = 60_000;

describe('integrations feature', () => {
  let bot: BotHarness;

  beforeEach(async () => {
    bot = await createBotHarness({ config: { encryptionKey: randomBytes(32).toString('base64') } });
  });
  afterEach(async () => {
    await bot.close();
  });

  describe('discord.integrations.relay', () => {
    let secret: string;
    let counter = 0;

    beforeEach(async () => {
      const admin = await bot.member({ roles: ['core'] });
      const created = await integrations.createIntegration(bot.kit.as(admin.actor), {
        provider: 'generic',
        name: 'CI',
        slug: 'ci-hooks',
        config: { relayChannelId: RELAY_CHANNEL },
      });
      secret = created.signingSecret!;
    });

    async function deliver(payload: unknown): Promise<string> {
      const rawBody = JSON.stringify(payload);
      const timestamp = String(Math.floor(bot.kit.clock.now().getTime() / 1000));
      counter++;
      const response = await integrations.receiveWebhook(bot.kit.as(anonymousActor), {
        slug: 'ci-hooks',
        rawBody,
        headers: {
          'x-jave-timestamp': timestamp,
          'x-jave-signature': integrations.signJave(secret, timestamp, rawBody),
          'x-jave-delivery': `d-${counter}`,
          'x-jave-event': 'deploy',
        },
        secrets: {},
      });
      expect(response.status).toBe(202);
      return String(response.body.deliveryId);
    }

    it('posts one sanitized panel and reports back', async () => {
      const deliveryId = await deliver({
        text: '@everyone deploy **done** <@123456789012345678> [x](https://evil.example)',
      });
      await bot.drain();
      const sent = bot.gateway.callsTo('sendMessage');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.args[0]).toBe(RELAY_CHANNEL);
      const payload = sent[0]!.args[1] as {
        embeds: { title: string; author: { name: string }; description: string }[];
        components?: unknown;
      };
      const embed = payload.embeds[0]!;
      expect(embed.author.name).toBe('INTEGRATION');
      expect(embed.title).toBe('CI · DEPLOY');
      expect(embed.description).not.toMatch(/@everyone/);
      expect(embed.description).not.toMatch(/<@\d+>/);
      expect(embed.description).toContain('\\*\\*done\\*\\*');
      expect(embed.description).toContain('\\[x\\]\\(https://evil.example\\)');
      expect(payload.components).toBeUndefined();
      const [row] = await bot.kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId));
      expect(row!.relayMessageId).toBeTruthy();
      expect(row!.relayedAt).not.toBeNull();
    });

    it('is idempotent: an already relayed delivery is skipped', async () => {
      const deliveryId = await deliver({ text: 'green' });
      await bot.drain();
      const [row] = await bot.kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId));
      await enqueueJob(bot.kit.system, integrations.DISCORD_INTEGRATIONS_RELAY_JOB, {
        deliveryId,
        channelId: RELAY_CHANNEL,
        title: 'CI · deploy',
        text: 'green',
      });
      await bot.drain();
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(1);
      const [after] = await bot.kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId));
      expect(after!.relayMessageId).toBe(row!.relayMessageId);
    });

    it('records permanent Discord failures on the delivery and the integration', async () => {
      bot.gateway.failures.set(
        'sendMessage',
        new DiscordActionError('send message failed: Missing Access', 50001, true),
      );
      const deliveryId = await deliver({ text: 'red' });
      await bot.drain();
      const [row] = await bot.kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId));
      expect(row!.lastError).toContain('relay failed: send message failed: Missing Access');
      expect(row!.relayMessageId).toBeNull();
      const [integration] = await bot.kit.db.select().from(integrationsTable);
      expect(integration!.lastError).toContain('Missing Access');
      const [job] = await bot.kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, integrations.DISCORD_INTEGRATIONS_RELAY_JOB));
      expect(job!.status).toBe('dead');
    });

    it('retries transient Discord failures', async () => {
      bot.gateway.failures.set('sendMessage', new DiscordActionError('rate limited', 429, false));
      const deliveryId = await deliver({ text: 'flaky' });
      await bot.drain();
      const [pending] = await bot.kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, integrations.DISCORD_INTEGRATIONS_RELAY_JOB));
      expect(pending!.status).toBe('pending');
      bot.kit.clock.advance(RETRY_DELAY_MS);
      await bot.drain();
      const [row] = await bot.kit.db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, deliveryId));
      expect(row!.relayMessageId).toBeTruthy();
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(2);
    });

    it('BREAK: invalid payloads dead-letter without touching Discord', async () => {
      await enqueueJob(bot.kit.system, integrations.DISCORD_INTEGRATIONS_RELAY_JOB, {
        deliveryId: 'not-a-uuid',
        channelId: '@everyone',
        title: '',
        text: 'x',
      });
      await enqueueJob(bot.kit.system, integrations.DISCORD_INTEGRATIONS_RELAY_JOB, {
        deliveryId: '00000000-0000-4000-8000-000000000000',
        channelId: RELAY_CHANNEL,
        title: 'ghost',
        text: 'no such delivery',
      });
      await bot.drain();
      const rows = await bot.kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, integrations.DISCORD_INTEGRATIONS_RELAY_JOB));
      expect(rows.map((row) => row.status)).toEqual(['dead', 'dead']);
      expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    });
  });

  describe('/github', () => {
    let member: Person;
    let staff: Person;

    beforeEach(async () => {
      member = await bot.member({ roles: ['verified'], username: 'octo' });
      staff = await bot.member({ roles: ['core'], username: 'staff' });
    });

    async function link(who: Person, username: string) {
      return bot.run({
        kind: 'modal',
        name: customId('integrations', 'ghlink'),
        user: who.user,
        modalText: { username },
      });
    }

    it('links a self-declared username and shows its status', async () => {
      const opened = await bot.run({
        kind: 'slash',
        name: 'github',
        subcommand: 'link',
        user: member.user,
      });
      expect(opened.interaction.responses[0]?.type).toBe('modal');
      const linked = await link(member, '@OctoDev');
      expect(linked.interaction.lastText()).toContain('GITHUB ACCOUNT LINKED');
      expect(linked.interaction.lastText()).toContain('octodev');
      const status = await bot.run({
        kind: 'slash',
        name: 'github',
        subcommand: 'status',
        user: member.user,
      });
      expect(status.interaction.lastText()).toContain('SELF-DECLARED');
      expect(buttonLabels(status.interaction.lastPayload())).toEqual([
        'CHANGE USERNAME',
        'UNLINK',
        'GITHUB PROFILE',
      ]);
    });

    it('BREAK: malformed and already-claimed usernames are refused', async () => {
      const bad = await link(member, 'not a login!');
      expect(bad.interaction.lastText()).toContain('INVALID INPUT');
      await link(staff, 'octodev');
      const taken = await link(member, 'OctoDev');
      expect(taken.interaction.lastText()).toContain('already linked to another member');
    });

    it('staff verify with the numeric id; the member sees VERIFIED', async () => {
      await link(member, 'octodev');
      const card = await bot.run({
        kind: 'slash',
        name: 'github',
        subcommand: 'verify',
        user: staff.user,
        options: { member: member.user },
      });
      expect(buttonLabels(card.interaction.lastPayload())).toEqual([
        'VERIFY',
        'UNLINK',
        'GITHUB PROFILE',
      ]);
      const opened = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghverifyopen', member.actor.memberId!),
        user: staff.user,
      });
      expect(opened.interaction.responses[0]?.type).toBe('modal');
      const verified = await bot.run({
        kind: 'modal',
        name: customId('integrations', 'ghverify', member.actor.memberId!),
        user: staff.user,
        modalText: { externalId: '4242' },
      });
      expect(verified.interaction.lastText()).toContain('GITHUB ACCOUNT VERIFIED');
      const status = await bot.run({
        kind: 'slash',
        name: 'github',
        subcommand: 'status',
        user: member.user,
      });
      expect(status.interaction.lastText()).toContain('VERIFIED');
      expect(status.interaction.lastText()).toContain('4242');
      const revoke = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghrevoke', member.actor.memberId!),
        user: staff.user,
      });
      expect(revoke.interaction.lastText()).toContain('VERIFICATION REVOKED');
      await bot.drain();
    });

    it('BREAK: members cannot verify anyone; staff cannot verify themselves', async () => {
      await link(member, 'octodev');
      await link(staff, 'staffdev');
      const command = await bot.run({
        kind: 'slash',
        name: 'github',
        subcommand: 'verify',
        user: member.user,
        options: { member: staff.user },
      });
      expect(command.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const button = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghverifyopen', member.actor.memberId!),
        user: member.user,
      });
      expect(button.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await bot.run({
        kind: 'modal',
        name: customId('integrations', 'ghverify', member.actor.memberId!),
        user: member.user,
        modalText: { externalId: '4242' },
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const self = await bot.run({
        kind: 'modal',
        name: customId('integrations', 'ghverify', staff.actor.memberId!),
        user: staff.user,
        modalText: { externalId: '1' },
      });
      expect(self.interaction.lastText()).toContain('cannot verify your own');
      const rows = await bot.kit.db.select().from(externalAccounts);
      expect(rows.every((row) => row.verifiedAt === null)).toBe(true);
    });

    it('unlinks after confirmation; forged unlinks of others are refused', async () => {
      await link(member, 'octodev');
      await link(staff, 'staffdev');
      const forged = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghunlinkok', staff.actor.memberId!),
        user: member.user,
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const confirm = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghunlink', member.actor.memberId!),
        user: member.user,
      });
      expect(confirm.interaction.lastText()).toContain('UNLINK GITHUB ACCOUNT');
      const done = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghunlinkok', member.actor.memberId!),
        user: member.user,
      });
      expect(done.interaction.lastText()).toContain('GITHUB ACCOUNT UNLINKED');
      const rows = await bot.kit.db.select().from(externalAccounts);
      expect(rows.map((row) => row.username)).toEqual(['staffdev']);
      const malformed = await bot.run({
        kind: 'button',
        name: customId('integrations', 'ghunlinkok', 'nope'),
        user: member.user,
      });
      expect(malformed.interaction.lastText()).toContain('NOT FOUND');
    });
  });
});
