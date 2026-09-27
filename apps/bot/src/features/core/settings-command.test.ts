import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs } from '@jave/database';
import {
  getSettings,
  revokeRoleUnchecked,
  TtlCache,
  updateSettings,
  type UserActor,
} from '@jave/core';
import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  ChannelType,
  ComponentType,
} from 'discord.js';
import { DiscordActionError } from '../../discord/gateway';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { InteractionUser } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import type { RecordedResponse } from '../../testing/fake-interaction';

const TEXT_CHANNEL = '600000000000000001';
const CATEGORY = '600000000000000002';
const LOCKED_CHANNEL = '600000000000000003';
const NEWS_CHANNEL = '600000000000000004';
const VERIFIED_ROLE = '500000000000000002';
const HIGH_ROLE = '500000000000000080';
const BOOSTER_ROLE = '500000000000000555';
const ADMIN_ROLE = '500000000000000070';
const MODS_ROLE = '500000000000000060';
const PATRON_ROLE = '500000000000000050';

type Person = { actor: UserActor; user: InteractionUser };

function componentsOf(response: RecordedResponse | undefined): APIComponentInMessageActionRow[] {
  if (!response || !('payload' in response)) return [];
  const rows = (response.payload.components ??
    []) as APIActionRowComponent<APIComponentInMessageActionRow>[];
  return rows.flatMap((r) => r.components);
}

function lastComponents(responses: RecordedResponse[]): APIComponentInMessageActionRow[] {
  return componentsOf([...responses].reverse().find((r) => 'payload' in r));
}

describe('/settings', () => {
  let bot: BotHarness;
  let founder: Person;
  let ops: Person;

  beforeEach(async () => {
    bot = await createBotHarness();
    founder = await bot.member({ roles: ['founder'] });
    ops = await bot.member({ roles: ['operations'] });
    bot.gateway.addGuildChannel(TEXT_CHANNEL, { name: 'welcome', kind: 'text' });
    bot.gateway.addGuildChannel(CATEGORY, { name: 'TRIALS', kind: 'category' });
    bot.gateway.addGuildChannel(LOCKED_CHANNEL, {
      name: 'locked',
      kind: 'text',
      denied: ['SendMessages', 'EmbedLinks'],
    });
    bot.gateway.addGuildChannel(NEWS_CHANNEL, { name: 'news', kind: 'announcement' });
    bot.gateway.addRole(VERIFIED_ROLE, 'Verified', 20);
    bot.gateway.addRole(HIGH_ROLE, 'Admins', 90);
    bot.gateway.addRole(BOOSTER_ROLE, 'Server Booster', 3, true);
    bot.gateway.addRole(ADMIN_ROLE, 'Operators', 30, false, ['Administrator', 'BanMembers']);
    bot.gateway.addRole(MODS_ROLE, 'Mods', 25, false, ['KickMembers', 'ModerateMembers']);
  });
  afterEach(async () => {
    await bot.close();
  });

  const settings = (user: InteractionUser, subcommand: string, options = {}) =>
    bot.run({ kind: 'slash', name: 'settings', user, subcommand, options });
  const press = (user: InteractionUser, id: string, values?: string[]) =>
    bot.run({ kind: values ? 'select' : 'button', name: id, user, values });

  describe('view', () => {
    it('summarizes settings; managers get the editing controls', async () => {
      const own = await settings(founder.user, 'view');
      expect(own.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(own.interaction.lastText()).toContain('JAVE SETTINGS');
      expect(own.interaction.lastText()).toContain('0 of 15 outputs set');
      expect(own.interaction.lastText()).toContain('Adversarial roles OFF');
      expect(lastComponents(own.interaction.responses)).toHaveLength(4);

      const readOnly = await settings(ops.user, 'view');
      expect(readOnly.interaction.lastText()).toContain('Read-only');
      expect(lastComponents(readOnly.interaction.responses)).toHaveLength(0);
    });

    it('BREAK: members without canViewSettings are refused', async () => {
      const member = await bot.member({ roles: ['verified'] });
      const { interaction } = await settings(member.user, 'view');
      expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
    });
  });

  describe('channels', () => {
    it('maps an output straight from the command and audits the change', async () => {
      const { interaction } = await settings(founder.user, 'channel', {
        output: 'welcome',
        channel: TEXT_CHANNEL,
      });
      expect(interaction.lastText()).toContain('CHANNEL SET');
      expect(interaction.lastText()).toContain(`WELCOME → <#${TEXT_CHANNEL}>`);
      expect((await getSettings(bot.kit.system, 'channels')).welcome).toBe(TEXT_CHANNEL);
      const [audit] = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'settings.updated'), eq(auditLogs.targetId, 'channels')));
      expect(audit!.actorUserId).toBe(founder.actor.userId);
      expect(audit!.context).toMatchObject({ changes: { welcome: { to: TEXT_CHANNEL } } });
    });

    it('walks the picker flow: output select → channel select → clear', async () => {
      const list = await settings(founder.user, 'channel');
      const select = lastComponents(list.interaction.responses)[0]!;
      expect(select).toMatchObject({
        type: ComponentType.StringSelect,
        custom_id: 'settings:channel',
      });

      const editor = await press(founder.user, 'settings:channel', ['trialsCategory']);
      expect(editor.interaction.responses[0]?.type).toBe('update');
      const picker = lastComponents(editor.interaction.responses)[0]!;
      expect(picker).toMatchObject({
        type: ComponentType.ChannelSelect,
        custom_id: 'settings:chset:trialsCategory',
        channel_types: [4],
      });

      const set = await press(founder.user, 'settings:chset:trialsCategory', [CATEGORY]);
      expect(set.interaction.lastText()).toContain('CHANNEL SET');
      expect((await getSettings(bot.kit.system, 'channels')).trialsCategory).toBe(CATEGORY);

      const cleared = await press(founder.user, 'settings:chclear:trialsCategory');
      expect(cleared.interaction.lastText()).toContain('CHANNEL CLEARED');
      expect((await getSettings(bot.kit.system, 'channels')).trialsCategory).toBeUndefined();
    });

    it('refuses the wrong kind of channel and channels outside the server', async () => {
      const wrongKind = await settings(founder.user, 'channel', {
        output: 'trialsCategory',
        channel: TEXT_CHANNEL,
      });
      expect(wrongKind.interaction.lastText()).toContain('Trials category needs a category.');
      const foreign = await press(founder.user, 'settings:chset:welcome', ['600000000000000999']);
      expect(foreign.interaction.lastText()).toContain('Channel not found.');
      const junk = await press(founder.user, 'settings:chset:welcome', ['not-a-snowflake']);
      expect(junk.interaction.lastText()).toContain('INVALID INPUT');
      expect((await getSettings(bot.kit.system, 'channels')).welcome).toBeUndefined();
    });

    it('keeps the panel when a pick is refused; tickets need a plain text channel', async () => {
      const editor = await press(founder.user, 'settings:channel', ['tickets']);
      expect(lastComponents(editor.interaction.responses)[0]).toMatchObject({
        type: ComponentType.ChannelSelect,
        channel_types: [ChannelType.GuildText],
      });
      const refused = await press(founder.user, 'settings:chset:tickets', [NEWS_CHANNEL]);
      // The panel is untouched; the refusal arrives as its own ephemeral message.
      expect(refused.interaction.responses.map((r) => r.type)).toEqual(['deferUpdate', 'followUp']);
      expect(refused.interaction.lastText()).toContain('Tickets needs a text channel.');
      expect(refused.interaction.lastPayload()!.ephemeral).toBe(true);
      expect((await getSettings(bot.kit.system, 'channels')).tickets).toBeUndefined();

      const news = await press(founder.user, 'settings:chset:announcements', [NEWS_CHANNEL]);
      expect(news.interaction.lastText()).toContain('CHANNEL SET');
    });

    it('saves but flags a channel where JAVE lacks permissions', async () => {
      const { interaction } = await settings(founder.user, 'channel', {
        output: 'announcements',
        channel: LOCKED_CHANNEL,
      });
      const text = interaction.lastText();
      expect(text).toContain('▲ CHANNEL SET');
      expect(text).toContain('JAVE is missing Send Messages, Embed Links.');
    });

    it('BREAK: view-only staff cannot change channels, even with forged controls', async () => {
      const direct = await settings(ops.user, 'channel', {
        output: 'welcome',
        channel: TEXT_CHANNEL,
      });
      expect(direct.interaction.lastText()).toContain('ACCESS RESTRICTED');
      for (const [id, values] of [
        ['settings:chset:welcome', [TEXT_CHANNEL]],
        ['settings:chclear:welcome', undefined],
        ['settings:panel:channels', undefined],
        ['settings:channel', ['welcome']],
      ] as const) {
        const forged = await press(ops.user, id, values ? [...values] : undefined);
        expect(forged.interaction.lastText(), id).toContain('ACCESS RESTRICTED');
      }
      expect((await getSettings(bot.kit.system, 'channels')).welcome).toBeUndefined();
      expect(bot.gateway.callsTo('botPermissionsIn')).toHaveLength(0);
    });

    it('BREAK: forged or stale custom ids are refused', async () => {
      const unknownKey = await press(founder.user, 'settings:chset:ownerDm', [TEXT_CHANNEL]);
      expect(unknownKey.interaction.lastText()).toContain('Unknown channel setting.');
      const unknownPanel = await press(founder.user, 'settings:panel:secrets');
      expect(unknownPanel.interaction.lastText()).toContain('EXPIRED');
      const noValue = await press(founder.user, 'settings:chset:welcome', []);
      expect(noValue.interaction.lastText()).toContain('EXPIRED');
    });
  });

  describe('roles', () => {
    it('maps a JAVE role and pushes it to existing members', async () => {
      const verified = await bot.member({ roles: ['verified'] });
      const editor = await settings(founder.user, 'role', { role: 'verified' });
      expect(lastComponents(editor.interaction.responses)[0]).toMatchObject({
        type: ComponentType.RoleSelect,
        custom_id: 'settings:roleset:verified',
      });
      const set = await press(founder.user, 'settings:roleset:verified', [VERIFIED_ROLE]);
      expect(set.interaction.lastText()).toContain(`VERIFIED → <@&${VERIFIED_ROLE}>`);
      expect((await getSettings(bot.kit.system, 'roles')).discordRoleIds.verified).toBe(
        VERIFIED_ROLE,
      );
      await bot.drain();
      expect(bot.gateway.members.get(verified.actor.discordId)!.roleIds).toContain(VERIFIED_ROLE);
    });

    it('refuses @everyone, managed and duplicate roles; warns about hierarchy', async () => {
      const everyone = await press(founder.user, 'settings:roleset:member', [bot.gateway.guildId]);
      expect(everyone.interaction.lastText()).toContain('@everyone cannot be mapped.');
      const managed = await press(founder.user, 'settings:roleset:supporter', [BOOSTER_ROLE]);
      expect(managed.interaction.lastText()).toContain('managed by an integration');

      await press(founder.user, 'settings:roleset:verified', [VERIFIED_ROLE]);
      const duplicate = await press(founder.user, 'settings:roleset:trial', [VERIFIED_ROLE]);
      expect(duplicate.interaction.lastText()).toContain('already mapped to VERIFIED');
      const quarantine = await press(founder.user, 'settings:roleset:quarantine', [VERIFIED_ROLE]);
      expect(quarantine.interaction.lastText()).toContain('quarantine needs its own role');

      const high = await press(founder.user, 'settings:roleset:core', [HIGH_ROLE]);
      expect(high.interaction.lastText()).toContain('▲ ROLE MAPPED');
      expect(high.interaction.lastText()).toContain("JAVE's role sits below");
    });

    it('BREAK: never hands a role with elevated permissions to non-staff members', async () => {
      for (const target of [
        'verified',
        'trial',
        'applicant',
        'member',
        'supporter',
        'quarantine',
      ]) {
        const refused = await press(founder.user, `settings:roleset:${target}`, [ADMIN_ROLE]);
        expect(refused.interaction.lastText(), target).toContain('grants Administrator.');
      }
      for (const target of ['verified', 'quarantine']) {
        const mods = await press(founder.user, `settings:roleset:${target}`, [MODS_ROLE]);
        expect(mods.interaction.lastText(), target).toContain(
          'grants Kick Members, Moderate Members.',
        );
      }
      expect(await getSettings(bot.kit.system, 'roles')).toMatchObject({ discordRoleIds: {} });
      expect((await getSettings(bot.kit.system, 'roles')).quarantineRoleId).toBeUndefined();

      const staff = await press(founder.user, 'settings:roleset:moderator', [MODS_ROLE]);
      expect(staff.interaction.lastText()).toContain(`MODERATOR → <@&${MODS_ROLE}>`);
    });

    it('never drops a mapping made elsewhere meanwhile (stale cache)', async () => {
      await press(founder.user, 'settings:roleset:verified', [VERIFIED_ROLE]);
      // The dashboard (another process, its own cache) maps SUPPORTER in the meantime.
      const dashboard = { ...bot.kit.as(founder.actor), cache: new TtlCache() };
      await updateSettings(dashboard, 'roles', (current) => ({
        discordRoleIds: { ...current.discordRoleIds, supporter: PATRON_ROLE },
      }));
      await press(founder.user, 'settings:roleset:moderator', [MODS_ROLE]);
      expect((await getSettings(dashboard, 'roles')).discordRoleIds).toEqual({
        verified: VERIFIED_ROLE,
        supporter: PATRON_ROLE,
        moderator: MODS_ROLE,
      });
    });

    it('BREAK: a Discord failure is a calm refusal that keeps the panel; nothing is written', async () => {
      bot.gateway.failures.set('listRoles', new DiscordActionError('Missing Access', 50001, true));
      const roles = await press(founder.user, 'settings:roleset:verified', [VERIFIED_ROLE]);
      expect(roles.outcome.errorId).toBeNull();
      expect(roles.interaction.responses.map((r) => r.type)).toEqual(['deferUpdate', 'followUp']);
      expect(roles.interaction.lastText()).toContain('SERVICE UNAVAILABLE');
      expect((await getSettings(bot.kit.system, 'roles')).discordRoleIds).toEqual({});

      bot.gateway.failures.set(
        'botPermissionsIn',
        new DiscordActionError('gateway timeout', null, false),
      );
      const channel = await settings(founder.user, 'channel', {
        output: 'welcome',
        channel: TEXT_CHANNEL,
      });
      expect(channel.outcome.errorId).toBeNull();
      expect(channel.interaction.lastText()).toContain('could not read the server');
      expect((await getSettings(bot.kit.system, 'channels')).welcome).toBeUndefined();
    });

    it('clears a mapping', async () => {
      await press(founder.user, 'settings:roleset:verified', [VERIFIED_ROLE]);
      const cleared = await press(founder.user, 'settings:roleclear:verified');
      expect(cleared.interaction.lastText()).toContain('VERIFIED is JAVE-only.');
      expect((await getSettings(bot.kit.system, 'roles')).discordRoleIds).toEqual({});
    });

    it('BREAK: only settings managers map roles', async () => {
      const denied = await press(ops.user, 'settings:roleset:operations', [VERIFIED_ROLE]);
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedTarget = await press(founder.user, 'settings:roleset:overlord', [VERIFIED_ROLE]);
      expect(forgedTarget.interaction.lastText()).toContain('Unknown role.');
      expect((await getSettings(bot.kit.system, 'roles')).discordRoleIds).toEqual({});
    });
  });

  describe('toggle', () => {
    it('switches plain flags immediately', async () => {
      const { interaction } = await settings(founder.user, 'toggle', { flag: 'applications.open' });
      expect(interaction.lastText()).toContain('APPLICATIONS OPEN → OFF');
      expect((await getSettings(bot.kit.system, 'applications')).open).toBe(false);
      const again = await press(founder.user, 'settings:flag', ['applications.open']);
      expect(again.interaction.lastText()).toContain('APPLICATIONS OPEN → ON');
    });

    it('asks for confirmation before sensitive flags change', async () => {
      const ask = await settings(founder.user, 'toggle', { flag: 'trials.adversarialEnabled' });
      expect(ask.interaction.lastText()).toContain('ADVERSARIAL ROLES → ON');
      expect((await getSettings(bot.kit.system, 'trials')).adversarialEnabled).toBe(false);
      const confirm = customId('settings', 'flagset', 'trials.adversarialEnabled', 'on');
      expect(lastComponents(ask.interaction.responses)[0]).toMatchObject({ custom_id: confirm });

      const done = await press(founder.user, confirm);
      expect(done.interaction.lastText()).toContain('FLAG SWITCHED');
      expect((await getSettings(bot.kit.system, 'trials')).adversarialEnabled).toBe(true);

      const stale = await press(founder.user, confirm);
      expect(stale.interaction.lastText()).toContain('NO CHANGE');
    });

    it('BREAK: view-only staff cannot switch flags or confirm a sensitive change', async () => {
      const direct = await settings(ops.user, 'toggle', { flag: 'applications.open' });
      expect(direct.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await press(ops.user, 'settings:flagset:trials.adversarialEnabled:on');
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect((await getSettings(bot.kit.system, 'trials')).adversarialEnabled).toBe(false);
      expect((await getSettings(bot.kit.system, 'applications')).open).toBe(true);
    });

    it('BREAK: raid mode and unknown flags cannot be switched here', async () => {
      const raid = await press(founder.user, 'settings:flagset:security.raidMode:on');
      expect(raid.interaction.lastText()).toContain('Unknown setting.');
      const junk = await press(founder.user, 'settings:flagset:trials.enabled:maybe');
      expect(junk.interaction.lastText()).toContain('Unknown state.');
      expect((await getSettings(bot.kit.system, 'security')).raidMode).toBe(false);
    });

    it('a demoted manager loses access to controls they already hold', async () => {
      const core = await bot.member({ roles: ['core'] });
      const ask = await settings(core.user, 'toggle', { flag: 'trials.adversarialEnabled' });
      const confirm = componentsOf(ask.interaction.responses.at(-1))[0]!;
      await revokeRoleUnchecked(bot.kit.system, {
        memberId: core.actor.memberId!,
        role: 'core',
        reason: 'demoted',
      });
      const late = await press(core.user, 'custom_id' in confirm ? confirm.custom_id : '');
      expect(late.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect((await getSettings(bot.kit.system, 'trials')).adversarialEnabled).toBe(false);
    });
  });
});
