import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, serverSettings } from '@jave/database';
import { updateSettings, type UserActor } from '@jave/core';
import type { APIButtonComponent } from 'discord.js';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { DiscordActionError } from '../../discord/gateway';
import type { InteractionUser } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { evaluateReadiness } from './readiness';
import { permissionLabel } from './settings-catalog';
import { fitLines } from './settings-ui';

const ROLE = {
  verified: '500000000000000002',
  member: '500000000000000001',
  quarantine: '500000000000000009',
  missing: '500000000000000404',
  booster: '500000000000000555',
  admin: '500000000000000070',
  mods: '500000000000000060',
};
const CHANNEL = {
  welcome: '600000000000000001',
  tickets: '600000000000000002',
  trials: '600000000000000003',
  deleted: '600000000000000404',
  hidden: '600000000000000005',
  news: '600000000000000006',
};

describe('/jave setup', () => {
  let bot: BotHarness;
  let founder: { actor: UserActor; user: InteractionUser };

  beforeEach(async () => {
    bot = await createBotHarness();
    founder = await bot.member({ roles: ['founder'] });
  });
  afterEach(async () => {
    await bot.close();
  });

  const setup = (user: InteractionUser) =>
    bot.run({ kind: 'slash', name: 'jave', user, subcommand: 'setup' });

  it('reports a fresh install: permissions fine, nothing mapped yet', async () => {
    const { interaction } = await setup(founder.user);
    const payload = interaction.lastPayload()!;
    expect(payload.ephemeral).toBe(true);
    const text = interaction.lastText();
    expect(text).toContain('JAVE SETUP');
    expect(text).toContain('Operational');
    expect(text).toContain('✓ All 16 required server permissions granted.');
    expect(text).toContain('▲ No JAVE role is mapped to a Discord role.');
    expect(text).toContain('▲ No quarantine role.');
    expect(text).toContain('Not set: Welcome, Announcements');
    const buttons = payload.components![0]!.components as APIButtonComponent[];
    expect(buttons.map((b) => ('custom_id' in b ? b.custom_id : null))).toEqual([
      'settings:panel:channels',
      'settings:panel:roles',
      'settings:panel:flags',
      'setup:recheck',
    ]);
  });

  it('lists every blocking problem with its fix', async () => {
    bot.gateway.botPermissions.delete('ManageRoles');
    bot.gateway.botAdministrator = false;
    bot.gateway.addRole(ROLE.verified, 'Verified', 60);
    bot.gateway.addRole(ROLE.member, 'Member', 10);
    bot.gateway.addRole(ROLE.booster, 'Server Booster', 5, true);
    bot.gateway.addGuildChannel(CHANNEL.welcome, { name: 'welcome', kind: 'text' });
    bot.gateway.addGuildChannel(CHANNEL.tickets, {
      name: 'tickets',
      kind: 'text',
      denied: ['CreatePrivateThreads'],
    });
    bot.gateway.addGuildChannel(CHANNEL.trials, { name: 'trials', kind: 'text' });
    bot.gateway.addGuildChannel(CHANNEL.hidden, { name: 'secret', kind: 'text', hidden: true });
    await updateSettings(bot.kit.as(founder.actor), 'roles', {
      discordRoleIds: {
        verified: ROLE.verified,
        member: ROLE.member,
        trial: ROLE.missing,
        supporter: ROLE.booster,
      },
      quarantineRoleId: ROLE.quarantine,
    });
    await updateSettings(bot.kit.as(founder.actor), 'channels', {
      welcome: CHANNEL.welcome,
      tickets: CHANNEL.tickets,
      trialsCategory: CHANNEL.trials,
      announcements: CHANNEL.deleted,
      securityAlerts: CHANNEL.hidden,
    });

    const text = (await setup(founder.user)).interaction.lastText();
    expect(text).toMatch(/\*\*\d+ issues to fix\*\*/);
    expect(text).toContain('✕ Manage Roles missing');
    expect(text).toContain(
      `✕ <@&${ROLE.verified}> (VERIFIED) sits at or above JAVE's highest role.`,
    );
    expect(text).toContain(`✕ TRIAL → role \`${ROLE.missing}\` no longer exists.`);
    expect(text).toContain(
      `✕ SUPPORTER → <@&${ROLE.booster}> is managed by an integration; Discord will not let JAVE assign it.`,
    );
    expect(text).toContain(`✕ QUARANTINE → role \`${ROLE.quarantine}\` no longer exists.`);
    expect(text).toContain('✕ Announcements — channel no longer exists.');
    expect(text).toContain(`✕ Security alerts — JAVE cannot see <#${CHANNEL.hidden}>.`);
    expect(text).toContain(`✕ Trials category — <#${CHANNEL.trials}> must be a category.`);
    expect(text).toContain(`✕ Tickets — <#${CHANNEL.tickets}> missing Create Private Threads.`);
    expect(text).toContain(`✓ Welcome — <#${CHANNEL.welcome}>`);
    expect(text).toContain('→ Drag JAVE');
  });

  it('fails a non-staff mapping to a role with elevated permissions, and tickets in a news channel', async () => {
    bot.gateway.addRole(ROLE.admin, 'Operators', 20, false, ['Administrator']);
    bot.gateway.addRole(ROLE.mods, 'Mods', 15, false, ['KickMembers', 'BanMembers']);
    bot.gateway.addGuildChannel(CHANNEL.news, { name: 'news', kind: 'announcement' });
    await updateSettings(bot.kit.as(founder.actor), 'roles', {
      discordRoleIds: { verified: ROLE.admin, moderator: ROLE.mods },
    });
    await updateSettings(bot.kit.as(founder.actor), 'channels', { tickets: CHANNEL.news });

    const text = (await setup(founder.user)).interaction.lastText();
    expect(text).toContain(
      `✕ VERIFIED → <@&${ROLE.admin}> grants Administrator; role sync never hands it out.`,
    );
    expect(text).not.toContain('MODERATOR → role');
    expect(text).toContain(`✕ Tickets — <#${CHANNEL.news}> must be a text channel.`);
  });

  it('fails Administrator behind a staff role, and a quarantine role that is also mapped', async () => {
    bot.gateway.addRole(ROLE.admin, 'Operators', 20, false, ['Administrator']);
    bot.gateway.addRole(ROLE.quarantine, 'Quarantine', 5);
    // Written before today's write rules existed: read back as stored, reported here.
    await bot.kit.db.insert(serverSettings).values({
      section: 'roles',
      value: {
        discordRoleIds: { core: ROLE.admin, member: ROLE.quarantine },
        quarantineRoleId: ROLE.quarantine,
        syncToDiscord: true,
      },
    });
    const text = (await setup(founder.user)).interaction.lastText();
    expect(text).toContain(
      `✕ CORE → <@&${ROLE.admin}> grants Administrator; role sync never hands it out.`,
    );
    expect(text).toContain(
      `✕ QUARANTINE → <@&${ROLE.quarantine}> is also mapped to MEMBER. Role sync would undo quarantines.`,
    );
  });

  it('fails staff-only outputs in channels members can read', async () => {
    bot.gateway.addRole(ROLE.verified, 'Verified', 20);
    bot.gateway.addGuildChannel(CHANNEL.welcome, {
      name: 'general',
      kind: 'text',
      viewers: [bot.gateway.guildId],
    });
    bot.gateway.addGuildChannel(CHANNEL.news, {
      name: 'lounge',
      kind: 'text',
      viewers: [ROLE.verified],
    });
    bot.gateway.addGuildChannel(CHANNEL.hidden, { name: 'staff-only', kind: 'text' });
    await updateSettings(bot.kit.as(founder.actor), 'roles', {
      discordRoleIds: { verified: ROLE.verified },
    });
    // Stored directly: the dashboard stores channel ids without inspecting Discord.
    await updateSettings(bot.kit.as(founder.actor), 'channels', {
      welcome: CHANNEL.welcome,
      modLog: CHANNEL.welcome,
      ticketArchive: CHANNEL.news,
      auditLog: CHANNEL.hidden,
    });
    const text = (await setup(founder.user)).interaction.lastText();
    expect(text).toContain(`✓ Welcome — <#${CHANNEL.welcome}>`);
    expect(text).toContain(
      `✕ Moderation log — <#${CHANNEL.welcome}> is readable by @everyone. It carries staff-only data.`,
    );
    expect(text).toContain(
      `✕ Ticket archive — <#${CHANNEL.news}> is readable by <@&${ROLE.verified}>.`,
    );
    expect(text).toContain(`✓ Audit log — <#${CHANNEL.hidden}>`);
  });

  describe('RE-SYNC ROLES', () => {
    const resync = (user: InteractionUser) =>
      bot.run({ kind: 'button', name: customId('setup', 'resync'), user });

    it('is offered once a role is mapped and sync is on; applies roles Discord refused before', async () => {
      const first = (await setup(founder.user)).interaction.lastPayload()!;
      expect(first.components).toHaveLength(1);

      bot.gateway.addRole(ROLE.verified, 'Verified', 60);
      const verified = await bot.member({ roles: ['verified'] });
      await updateSettings(bot.kit.as(founder.actor), 'roles', {
        discordRoleIds: { verified: ROLE.verified },
      });
      await bot.drain();
      const holder = () => bot.gateway.members.get(verified.actor.discordId)!.roleIds;
      expect(holder()).toEqual([]);

      const blocked = await setup(founder.user);
      expect(blocked.interaction.lastText()).toContain('then press Re-sync roles');
      const buttons = blocked.interaction.lastPayload()!.components![1]!
        .components as APIButtonComponent[];
      expect(buttons.map((b) => ('custom_id' in b ? b.custom_id : null))).toEqual(['setup:resync']);

      bot.gateway.botHighestRolePosition = 70;
      const { interaction } = await resync(founder.user);
      expect(interaction.responses[0]).toEqual({ type: 'deferUpdate' });
      expect(interaction.lastText()).toContain('ROLE RE-SYNC QUEUED');
      expect(interaction.lastText()).toContain('READINESS');
      await bot.drain();
      expect(holder()).toEqual([ROLE.verified]);
      const [audit] = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'settings.roles_resync_requested'));
      expect(audit!.actorUserId).toBe(founder.actor.userId);
    });

    it('BREAK: refused for non-managers, and while role sync is off (panel kept)', async () => {
      const ops = await bot.member({ roles: ['operations'] });
      const denied = await resync(ops.user);
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');

      await updateSettings(bot.kit.as(founder.actor), 'roles', { syncToDiscord: false });
      const off = await resync(founder.user);
      expect(off.interaction.responses.map((r) => r.type)).toEqual(['deferUpdate', 'followUp']);
      expect(off.interaction.lastText()).toContain('Role sync is off.');
      expect(
        await bot.kit.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'settings.roles_resync_requested')),
      ).toEqual([]);
    });
  });

  it('warns when the bot holds Administrator (least privilege)', async () => {
    bot.gateway.botAdministrator = true;
    const text = (await setup(founder.user)).interaction.lastText();
    expect(text).toContain('▲ Administrator granted.');
    expect(text).toContain('Remove Administrator');
  });

  it('RE-CHECK re-runs the check in place', async () => {
    const { interaction } = await bot.run({
      kind: 'button',
      name: customId('setup', 'recheck'),
      user: founder.user,
    });
    expect(interaction.responses[0]).toEqual({ type: 'deferUpdate' });
    expect(interaction.responses[1]?.type).toBe('editReply');
    expect(interaction.lastText()).toContain('READINESS');
  });

  it('BREAK: staff without canManageSettings cannot run the check, even with a forged button', async () => {
    const ops = await bot.member({ roles: ['operations'] });
    const member = await bot.member({ roles: ['verified'] });
    for (const user of [ops.user, member.user]) {
      expect((await setup(user)).interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await bot.run({ kind: 'button', name: 'setup:recheck', user });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
    }
    expect(bot.gateway.callsTo('botMember')).toHaveLength(0);
    const denials = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'access.denied'));
    expect(denials.length).toBeGreaterThanOrEqual(4);
  });

  it('BREAK: a Discord outage renders a calm retryable error, not a crash', async () => {
    bot.gateway.failures.set('botMember', new DiscordActionError('gateway timeout', null, false));
    const { interaction, outcome } = await setup(founder.user);
    expect(outcome.errorId).toBeNull();
    expect(interaction.lastText()).toContain('SERVICE UNAVAILABLE');
    expect(interaction.lastText()).toContain('could not read the server');
  });

  it('BREAK: forged setup actions are refused', async () => {
    const { interaction } = await bot.run({
      kind: 'button',
      name: 'setup:nuke',
      user: founder.user,
    });
    expect(interaction.lastText()).toContain('EXPIRED');
  });
});

describe('readiness helpers', () => {
  it('labels permissions for humans', () => {
    expect(permissionLabel('SendMessagesInThreads')).toBe('Send Messages In Threads');
    expect(permissionLabel('ViewChannel')).toBe('View Channel');
  });

  it('fits lines into a field without cutting a line', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(40)}`);
    const value = fitLines(lines, 200);
    expect(value.length).toBeLessThanOrEqual(200);
    expect(value).toMatch(/… \d+ more$/);
    for (const line of value.split('\n').slice(0, -1)) expect(lines).toContain(line);
    expect(fitLines(['a', 'b'])).toBe('a\nb');
  });

  it('counts failures and warnings', () => {
    const report = evaluateReadiness({
      bot: { userId: '1', permissions: [], administrator: false, highestRolePosition: 1 },
      roles: [],
      roleSettings: { discordRoleIds: {}, syncToDiscord: false },
      channelSettings: {},
      channels: new Map(),
    });
    expect(report.failures).toBe(16);
    expect(report.warnings).toBe(4);
  });
});
