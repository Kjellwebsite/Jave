import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, notificationDeliveries } from '@jave/database';
import { grantRoleUnchecked, notify, updateProfile, updateSettings } from '@jave/core';
import { createBotHarness, discordUser, type BotHarness } from '../../testing/harness';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import { planRoleSync } from './role-sync';

describe('core feature', () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await createBotHarness();
  });
  afterEach(async () => {
    await bot.close();
  });

  describe('onboarding', () => {
    it('/start opens the profile modal and the submission completes onboarding', async () => {
      const user = discordUser('210000000000000001', 'nova');
      const start = await bot.run({ kind: 'slash', name: 'start', user });
      const modal = start.interaction.responses[0];
      expect(modal?.type).toBe('modal');
      const submit = await bot.run({
        kind: 'modal',
        name: customId('onboard', 'submit'),
        user,
        modalText: { displayName: 'Nova', headline: 'Builds rockets' },
        modalSelect: { primaryDomain: ['create'], visibility: ['public'] },
      });
      expect(submit.interaction.lastText()).toContain('PROFILE INITIALIZED');
      const [member] = await bot.kit.db.select().from(members);
      expect(member).toMatchObject({
        displayName: 'Nova',
        onboardingState: 'completed',
        primaryDomain: 'create',
        profileVisibility: 'public',
      });
    });

    it('BREAK: rejects forged modal values', async () => {
      const user = discordUser('210000000000000002');
      await bot.run({ kind: 'slash', name: 'start', user });
      const submit = await bot.run({
        kind: 'modal',
        name: customId('onboard', 'submit'),
        user,
        modalText: { displayName: 'x'.repeat(500) },
        modalSelect: { primaryDomain: ['godmode'], visibility: ['public'] },
      });
      expect(submit.interaction.lastText()).toContain('INVALID INPUT');
    });
  });

  describe('profile', () => {
    it('renders the JVLN card privately by default', async () => {
      const { user } = await bot.member({ roles: ['verified'], username: 'kjell' });
      const { interaction } = await bot.run({ kind: 'slash', name: 'profile', user });
      const payload = interaction.lastPayload()!;
      expect(payload.ephemeral).toBe(true);
      const embed = payload.embeds![0]!;
      expect(embed.author?.name).toBe('JVLN PROFILE');
      expect(embed.title).toContain('VERIFIED');
      expect(embed.fields!.map((f) => f.name)).toEqual(
        expect.arrayContaining([
          'MIND',
          'CREATE',
          'BODY',
          'LIFE',
          'BIO',
          'TRIALS',
          'PASSED',
          'PROJECTS',
        ]),
      );
    });

    it('shares publicly only when asked and the profile is not staff-only', async () => {
      const { user, actor } = await bot.member({ roles: ['verified'] });
      const shared = await bot.run({
        kind: 'slash',
        name: 'profile',
        user,
        options: { share: true },
      });
      expect(shared.interaction.lastPayload()!.ephemeral).toBe(false);
      await updateProfile(bot.kit.as(actor), actor.memberId!, { profileVisibility: 'staff' });
      const hidden = await bot.run({
        kind: 'slash',
        name: 'profile',
        user,
        options: { share: true },
      });
      expect(hidden.interaction.lastPayload()!.ephemeral).toBe(true);
    });

    it('BREAK: staff-only profiles are not visible to other members', async () => {
      const owner = await bot.member({ roles: ['verified'] });
      await updateProfile(bot.kit.as(owner.actor), owner.actor.memberId!, {
        profileVisibility: 'staff',
      });
      const viewer = await bot.member({ roles: ['verified'] });
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'profile',
        user: viewer.user,
        options: { member: owner.user },
      });
      expect(interaction.lastText()).toContain('NOT FOUND');
      const staff = await bot.member({ roles: ['moderator'] });
      const staffView = await bot.run({
        kind: 'user_context',
        name: 'JVLN Profile',
        user: staff.user,
        targetUser: owner.user,
      });
      expect(staffView.interaction.lastText()).toContain('JVLN PROFILE');
    });

    it('capabilities button shows the facet breakdown', async () => {
      const { user, actor } = await bot.member();
      const { interaction } = await bot.run({
        kind: 'button',
        name: customId('profile', 'facets', actor.memberId!),
        user,
      });
      expect(interaction.lastText()).toContain('Reasoning');
    });
  });

  describe('/rank', () => {
    it('claims a rank with evidence and shows it as CLAIMED', async () => {
      const { user } = await bot.member({ roles: ['verified'] });
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'rank',
        user,
        subcommand: 'claim',
        options: {
          capability: 'create.technical',
          rank: 'a',
          evidence_url: 'https://github.com/example/compiler',
          evidence_title: 'Compiler',
        },
      });
      expect(interaction.lastText()).toContain('CLAIM RECORDED');
      expect(interaction.lastText()).toContain('CLAIMED');
      const view = await bot.run({ kind: 'slash', name: 'rank', user, subcommand: 'view' });
      expect(view.interaction.lastText()).toContain('A ◇');
    });

    it('autocompletes capabilities and ranks', async () => {
      const { user } = await bot.member();
      const facets = await bot.run({
        kind: 'autocomplete',
        name: 'rank',
        user,
        focused: { name: 'capability', value: 'tech' },
      });
      const choices = facets.interaction.responses[0];
      expect(choices).toMatchObject({ type: 'autocomplete' });
      expect(choices && 'choices' in choices ? choices.choices.map((c) => c.value) : []).toContain(
        'create.technical',
      );
      const ranks = await bot.run({
        kind: 'autocomplete',
        name: 'rank',
        user,
        focused: { name: 'rank', value: '' },
      });
      const rankChoices = ranks.interaction.responses[0];
      expect(rankChoices && 'choices' in rankChoices ? rankChoices.choices[0]?.value : null).toBe(
        'S',
      );
    });

    it('evaluators verify ranks; members and self-verification are refused', async () => {
      const evaluator = await bot.member({ roles: ['core'] });
      const target = await bot.member({ roles: ['verified'] });
      const ok = await bot.run({
        kind: 'slash',
        name: 'rank',
        user: evaluator.user,
        subcommand: 'verify',
        options: {
          member: target.user,
          capability: 'mind.research',
          rank: 'B',
          reason: 'Replication study reviewed',
        },
      });
      expect(ok.interaction.lastText()).toContain('VERIFIED RANK SET');

      const member = await bot.member({ roles: ['verified'] });
      const denied = await bot.run({
        kind: 'slash',
        name: 'rank',
        user: member.user,
        subcommand: 'verify',
        options: {
          member: target.user,
          capability: 'mind.research',
          rank: 'S',
          reason: 'trust me',
        },
      });
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const self = await bot.run({
        kind: 'slash',
        name: 'rank',
        user: evaluator.user,
        subcommand: 'verify',
        options: { member: evaluator.user, capability: 'mind.research', rank: 'S', reason: 'self' },
      });
      expect(self.interaction.lastText()).toContain('cannot verify your own');
    });

    it('history is private to self and staff', async () => {
      const a = await bot.member({ roles: ['verified'] });
      const b = await bot.member({ roles: ['verified'] });
      const denied = await bot.run({
        kind: 'slash',
        name: 'rank',
        user: b.user,
        subcommand: 'history',
        options: { member: a.user },
      });
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const own = await bot.run({
        kind: 'slash',
        name: 'rank',
        user: a.user,
        subcommand: 'history',
      });
      expect(own.interaction.lastText()).toContain('No rank changes');
    });
  });

  describe('/help and /jave status', () => {
    it('lists only commands the user may use', async () => {
      const { user } = await bot.member();
      const { interaction } = await bot.run({ kind: 'slash', name: 'help', user });
      const text = interaction.lastText();
      expect(text).toContain('/profile');
      expect(text).toContain('/rank');
      expect(text).toContain('/start');
    });

    it('reports system status', async () => {
      const { user } = await bot.member({ roles: ['moderator'] });
      bot.app.worker.start();
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'jave',
        user,
        subcommand: 'status',
      });
      await bot.app.worker.stop();
      const text = interaction.lastText();
      for (const label of ['Discord', 'Database', 'Queue', 'Webhooks'])
        expect(text).toContain(label);
      bot.gateway.ready = false;
      const down = await bot.run({ kind: 'slash', name: 'jave', user, subcommand: 'status' });
      expect(down.interaction.lastText()).toContain('SYSTEM DOWN');
    });
  });

  describe('role sync', () => {
    it('plans only managed roles', () => {
      const mapping = { member: '1', verified: '2', moderator: '3' };
      expect(planRoleSync(['verified'], mapping, ['1', '99'])).toEqual({
        add: ['2'],
        remove: ['1'],
      });
      expect(planRoleSync([], mapping, ['99'])).toEqual({ add: [], remove: [] });
    });

    it('applies JAVE roles to Discord after a grant', async () => {
      const founder = await bot.member({ roles: ['founder'] });
      await updateSettings(bot.kit.as(founder.actor), 'roles', {
        discordRoleIds: { member: '500000000000000001', verified: '500000000000000002' },
      });
      const target = await bot.member();
      bot.gateway.members.get(target.actor.discordId)!.roleIds.push('500000000000000001');
      await grantRoleUnchecked(bot.kit.system, {
        memberId: target.actor.memberId!,
        role: 'verified',
        reason: 'test',
      });
      await bot.drain();
      expect(bot.gateway.members.get(target.actor.discordId)!.roleIds).toEqual([
        '500000000000000002',
      ]);
    });

    it('skips members who left the guild', async () => {
      const target = await bot.member();
      bot.gateway.members.delete(target.actor.discordId);
      await grantRoleUnchecked(bot.kit.system, {
        memberId: target.actor.memberId!,
        role: 'supporter',
        reason: 'test',
      });
      await bot.drain();
      expect(bot.gateway.callsTo('addRoles')).toHaveLength(0);
    });
  });

  describe('notification delivery', () => {
    it('delivers DMs, records closed DMs, and fails permanently on hard errors', async () => {
      const a = await bot.member();
      const b = await bot.member();
      const c = await bot.member();
      bot.gateway.closedDms.add(b.actor.discordId);
      for (const m of [a, b, c]) {
        await notify(bot.kit.system, {
          recipientUserId: m.actor.userId,
          type: 'mission.assigned',
          title: 'MISSION ASSIGNED',
          body: 'Ship @everyone the thing',
          url: 'javascript:alert(1)',
        });
      }
      bot.gateway.failures.set('sendDirectMessage', new DiscordActionError('blocked', 50001, true));
      await bot.drain();
      const deliveries = await bot.kit.db.select().from(notificationDeliveries);
      const statuses = deliveries.map((d) => d.status).sort();
      expect(statuses).toEqual(['failed', 'sent', 'skipped']);
      const dm = bot.gateway.dms[0]!;
      expect(dm.payload.components).toBeUndefined(); // javascript: URL dropped
      expect(dm.payload.embeds![0]!.description).not.toContain('@everyone');
    });
  });

  describe('gateway events', () => {
    it('records joins, syncs roles, posts a welcome, and records leaves', async () => {
      const founder = await bot.member({ roles: ['founder'] });
      await updateSettings(bot.kit.as(founder.actor), 'roles', {
        discordRoleIds: { member: '500000000000000001' },
      });
      await updateSettings(bot.kit.as(founder.actor), 'channels', {
        welcome: '600000000000000001',
      });
      bot.gateway.addMember('220000000000000001', 'newcomer');
      await bot.app.events.memberJoin({
        id: '220000000000000001',
        username: 'newcomer',
        globalName: null,
        avatar: null,
        bot: false,
        joinedAt: new Date(),
      });
      await bot.settle();
      expect(bot.gateway.members.get('220000000000000001')!.roleIds).toContain(
        '500000000000000001',
      );
      expect(bot.gateway.callsTo('sendMessage')[0]!.args[0]).toBe('600000000000000001');
      await bot.app.events.memberLeave('220000000000000001');
      const rows = await bot.kit.db.select().from(members).where(eq(members.handle, 'newcomer'));
      expect(rows[0]!.guildStatus).toBe('departed');
    });

    it('isolates failures in one feature from the others', async () => {
      await expect(bot.app.events.memberLeave('999999999999999999')).resolves.toBeUndefined();
    });
  });
});
