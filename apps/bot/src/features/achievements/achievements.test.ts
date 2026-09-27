import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { auditLogs, memberAchievements } from '@jave/database';
import { achievements, updateProfile, updateSettings } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { InteractionUser, ModalPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import type { FakeInteraction } from '../../testing/fake-interaction';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const CHANNEL = '400000000000000001';

function autocompleteChoices(interaction: FakeInteraction) {
  const response = interaction.responses[0];
  return response && response.type === 'autocomplete' ? response.choices : [];
}

function modalOf(interaction: FakeInteraction): ModalPayload | null {
  const response = interaction.responses.find((r) => r.type === 'modal');
  return response && response.type === 'modal' ? response.modal : null;
}

/** Option values of the first string select inside a modal. */
function modalSelectValues(modal: ModalPayload): string[] {
  const json = JSON.stringify(modal);
  const match = /"options":(\[[^\]]*\])/.exec(json);
  if (!match) return [];
  return (JSON.parse(match[1]!) as { value: string }[]).map((option) => option.value);
}

function customIds(interaction: FakeInteraction): string[] {
  const payload = interaction.lastPayload();
  return (payload?.components ?? []).flatMap((row) =>
    row.components.map((component) => ('custom_id' in component ? component.custom_id : '')),
  );
}

describe('achievements feature', () => {
  let bot: BotHarness;
  let ops: { actor: Awaited<ReturnType<BotHarness['member']>>['actor']; user: InteractionUser };
  let core: typeof ops;

  beforeEach(async () => {
    bot = await createBotHarness();
    core = await bot.member({ roles: ['core'], username: 'core' });
    ops = await bot.member({ roles: ['operations'], username: 'ops' });
    await achievements.seedStarterAchievements(bot.kit.as(core.actor));
    await bot.drain();
  });
  afterEach(async () => {
    await bot.close();
  });

  /** Text of every catalog page, as `user` sees `memberId`. */
  async function allPages(user: InteractionUser, memberId: string): Promise<string[]> {
    const pages: string[] = [];
    for (const page of [0, 1]) {
      const { interaction } = await bot.run({
        kind: 'button',
        name: customId('achievements', 'page', memberId, page),
        user,
      });
      pages.push(interaction.lastText());
    }
    return pages;
  }

  async function heldKeys(memberId: string): Promise<string[]> {
    const rows = await bot.kit.db
      .select()
      .from(memberAchievements)
      .where(and(eq(memberAchievements.memberId, memberId), isNull(memberAchievements.revokedAt)));
    return rows.map((row) => row.achievementKey).sort();
  }

  describe('/achievements view', () => {
    it('shows the catalog with unlocks, rarity, share of members and masked hidden entries', async () => {
      const member = await bot.member({ roles: ['verified'], username: 'mara' });
      await achievements.awardAchievement(bot.kit.as(ops.actor), {
        memberId: member.actor.memberId!,
        key: 'team_leader',
        reason: 'Led team three through the build trial.',
      });
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: member.user,
      });
      const payload = interaction.lastPayload()!;
      expect(payload.ephemeral).toBe(true);
      const text = interaction.lastText();
      expect(text).toContain('JVLN ACHIEVEMENTS');
      expect(text).toContain(`**1** of ${achievements.STARTER_ACHIEVEMENTS.length} unlocked`);
      expect(text).toContain('✓ **TEAM LEADER** · NOTABLE — Led a team to a result.');
      expect(text).toMatch(/TEAM LEADER.* · \d+(\.\d)?%/);
      // Nobody holds it yet: no "0%" noise.
      expect(text).toContain('— FIRST MISSION · STANDARD — First mission verified.\n');
      const classified = (await allPages(member.user, member.actor.memberId!)).join('\n');
      expect(classified).toContain('▸ HIDDEN · RARE — Classified.');
      expect(classified).not.toContain('ADVERSARY');
      // Members see no staff controls, only paging.
      expect(customIds(interaction)).toEqual([
        customId('achievements', 'page', member.actor.memberId!, -1),
        customId('achievements', 'page', member.actor.memberId!, 1),
      ]);
    });

    it('pages with buttons and clamps forged page numbers', async () => {
      const member = await bot.member({ roles: ['verified'] });
      const memberId = member.actor.memberId!;
      const next = await bot.run({
        kind: 'button',
        name: customId('achievements', 'page', memberId, 1),
        user: member.user,
      });
      expect(next.interaction.responses[0]?.type).toBe('update');
      expect(next.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('Page 2 of 2');
      for (const forged of ['999', '-4', 'NaN']) {
        const page = await bot.run({
          kind: 'button',
          name: `achievements:page:${memberId}:${forged}`,
          user: member.user,
        });
        expect(page.interaction.lastPayload()!.embeds![0]!.footer!.text).toMatch(/Page [12] of 2/);
      }
    });

    it('reveals a hidden achievement the member unlocked, on their view and to others', async () => {
      const holder = await bot.member({ roles: ['verified'], username: 'sana' });
      await achievements.awardAchievement(bot.kit.as(ops.actor), {
        memberId: holder.actor.memberId!,
        key: 'adversary',
        reason: 'Revealed after the trial closed.',
      });
      const viewer = await bot.member({ roles: ['verified'] });
      const { interaction } = await bot.run({
        kind: 'user_context',
        name: 'JVLN Achievements',
        user: viewer.user,
        targetUser: holder.user,
      });
      expect(interaction.lastText()).toContain('✓ **ADVERSARY** · RARE');
      const text = (await allPages(viewer.user, holder.actor.memberId!)).join('\n');
      // Two hidden starters remain classified; the revealed one took its masked slot.
      expect(text.match(/HIDDEN ·/g)).toHaveLength(2);
      expect(text).not.toContain('RELENTLESS');
    });

    it('shares publicly without controls, but never a staff-only profile', async () => {
      const member = await bot.member({ roles: ['verified'] });
      const shared = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: member.user,
        options: { share: true },
      });
      expect(shared.interaction.lastPayload()!.ephemeral).toBe(false);
      expect(shared.interaction.lastPayload()!.components).toBeUndefined();
      await updateProfile(bot.kit.as(member.actor), member.actor.memberId!, {
        profileVisibility: 'staff',
      });
      const hidden = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: member.user,
        options: { share: true },
      });
      expect(hidden.interaction.lastPayload()!.ephemeral).toBe(true);
    });

    it('BREAK: a staff-only profile is NOT FOUND for other members, visible to staff', async () => {
      const owner = await bot.member({ roles: ['verified'] });
      await updateProfile(bot.kit.as(owner.actor), owner.actor.memberId!, {
        profileVisibility: 'staff',
      });
      const viewer = await bot.member({ roles: ['verified'] });
      const denied = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: viewer.user,
        options: { member: owner.user },
      });
      expect(denied.interaction.lastText()).toContain('NOT FOUND');
      const paged = await bot.run({
        kind: 'button',
        name: customId('achievements', 'page', owner.actor.memberId!, 0),
        user: viewer.user,
      });
      expect(paged.interaction.lastText()).toContain('NOT FOUND');
      const staff = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: ops.user,
        options: { member: owner.user },
      });
      expect(staff.interaction.lastText()).toContain('JVLN ACHIEVEMENTS');
    });

    it('BREAK: forged or stale custom ids are refused', async () => {
      const member = await bot.member();
      const forged = await bot.run({
        kind: 'button',
        name: 'achievements:page:not-a-uuid:0',
        user: member.user,
      });
      expect(forged.interaction.lastText()).toContain('NOT FOUND');
      const unknown = await bot.run({
        kind: 'button',
        name: customId('achievements', 'escalate', member.actor.memberId!),
        user: member.user,
      });
      expect(unknown.interaction.lastText()).toContain('EXPIRED');
      const bare = await bot.run({ kind: 'button', name: 'achievements:award', user: member.user });
      expect(bare.interaction.lastText()).toContain('EXPIRED');
    });
  });

  describe('staff award, revoke and verify', () => {
    it('autocompletes the full catalog for staff and nothing for members', async () => {
      const staff = await bot.run({
        kind: 'autocomplete',
        name: 'achievements',
        subcommand: 'award',
        user: ops.user,
        focused: { name: 'achievement', value: 'adv' },
      });
      expect(autocompleteChoices(staff.interaction)).toEqual([
        { name: 'ADVERSARY · RARE · HIDDEN', value: 'adversary' },
      ]);
      const member = await bot.member({ roles: ['verified'] });
      const leak = await bot.run({
        kind: 'autocomplete',
        name: 'achievements',
        subcommand: 'award',
        user: member.user,
        focused: { name: 'achievement', value: '' },
      });
      expect(autocompleteChoices(leak.interaction)).toEqual([]);
    });

    it('awards by slash command, announces publicly, and revokes with retraction', async () => {
      await updateSettings(bot.kit.system, 'channels', { achievements: CHANNEL });
      const target = await bot.member({ roles: ['verified'], username: 'jun' });
      const awarded = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'award',
        user: ops.user,
        options: {
          member: target.user,
          achievement: 'team_leader',
          reason: 'Led team three through the build trial.',
        },
      });
      expect(awarded.interaction.lastText()).toContain('ACHIEVEMENT AWARDED');
      expect(awarded.interaction.lastText()).toContain('TEAM LEADER');
      const [post] = bot.gateway.callsTo('sendMessage');
      expect(post?.args[0]).toBe(CHANNEL);
      const message = post?.args[1] as { content: string; embeds: { title: string }[] };
      expect(message.content).toBe(`<@${target.actor.discordId}>`);
      expect(message.embeds[0]!.title).toBe(
        'ACHIEVEMENT UNLOCKED — TEAM LEADER — Led a team to a result.',
      );
      expect(bot.gateway.messages.size).toBe(1);

      const revoked = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'revoke',
        user: ops.user,
        options: { member: target.user, achievement: 'team_leader', reason: 'Awarded in error.' },
      });
      expect(revoked.interaction.lastText()).toContain('ACHIEVEMENT REVOKED');
      expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(1);
      expect(bot.gateway.messages.size).toBe(0);
      expect(await heldKeys(target.actor.memberId!)).toEqual([]);
    });

    it('awards and revokes through the member view: button → modal → submit', async () => {
      const target = await bot.member({ roles: ['verified'], username: 'ilya' });
      const memberId = target.actor.memberId!;
      const view = await bot.run({
        kind: 'user_context',
        name: 'JVLN Achievements',
        user: ops.user,
        targetUser: target.user,
      });
      expect(customIds(view.interaction)).toContain(customId('achievements', 'award', memberId));
      const opened = await bot.run({
        kind: 'button',
        name: customId('achievements', 'award', memberId),
        user: ops.user,
      });
      const modal = modalOf(opened.interaction)!;
      expect(modal.custom_id).toBe(customId('achievements', 'award', memberId));
      expect(modalSelectValues(modal)).toContain('adversary');
      const submitted = await bot.run({
        kind: 'modal',
        name: customId('achievements', 'award', memberId),
        user: ops.user,
        modalSelect: { achievement: ['first_trial'] },
        modalText: { reason: 'Result published by hand after an import failure.' },
      });
      expect(submitted.interaction.lastText()).toContain('FIRST TRIAL');
      expect(await heldKeys(memberId)).toEqual(['first_trial']);

      const again = await bot.run({
        kind: 'button',
        name: customId('achievements', 'award', memberId),
        user: ops.user,
      });
      expect(modalSelectValues(modalOf(again.interaction)!)).not.toContain('first_trial');

      const revokeModal = await bot.run({
        kind: 'button',
        name: customId('achievements', 'revoke', memberId),
        user: ops.user,
      });
      expect(modalSelectValues(modalOf(revokeModal.interaction)!)).toEqual(['first_trial']);
      await bot.run({
        kind: 'modal',
        name: customId('achievements', 'revoke', memberId),
        user: ops.user,
        modalSelect: { achievement: ['first_trial'] },
        modalText: { reason: 'Duplicate of the automatic award.' },
      });
      expect(await heldKeys(memberId)).toEqual([]);
    });

    it('verifies a pending award with four eyes', async () => {
      await achievements.createAchievementDefinition(bot.kit.as(core.actor), {
        key: 'mentor',
        title: 'Mentor',
        summary: 'Brought someone else up to speed.',
        description: 'Mentored a member to a verified result.',
        category: 'leadership',
        criteria: { type: 'manual' },
        requiresVerification: true,
      });
      const target = await bot.member({ roles: ['verified'] });
      const memberId = target.actor.memberId!;
      await bot.run({
        kind: 'modal',
        name: customId('achievements', 'award', memberId),
        user: ops.user,
        modalSelect: { achievement: ['mentor'] },
        modalText: { reason: 'Mentored the autumn cohort.' },
      });
      const view = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'view',
        user: ops.user,
        options: { member: target.user },
      });
      expect(view.interaction.lastText()).toContain('◇ **MENTOR**');
      expect(view.interaction.lastText()).toContain('pending verification');
      expect(customIds(view.interaction)).toContain(customId('achievements', 'verify', memberId));

      const own = await bot.run({
        kind: 'select',
        name: customId('achievements', 'verify_pick', memberId),
        user: ops.user,
        values: ['mentor'],
      });
      expect(own.interaction.lastText()).toContain('NOTHING VERIFIED');
      expect(own.interaction.lastText()).toContain('Someone other than the awarder');

      const picker = await bot.run({
        kind: 'button',
        name: customId('achievements', 'verify', memberId),
        user: core.user,
      });
      expect(customIds(picker.interaction)).toEqual([
        customId('achievements', 'verify_pick', memberId),
      ]);
      const verified = await bot.run({
        kind: 'select',
        name: customId('achievements', 'verify_pick', memberId),
        user: core.user,
        values: ['mentor', 'mentor', 'nonexistent_key'],
      });
      expect(verified.interaction.responses[0]?.type).toBe('update');
      expect(verified.interaction.lastText()).toContain('1 AWARD VERIFIED');
      // User-provided values are escaped before they are echoed.
      expect(verified.interaction.lastText()).toContain(
        '✕ NONEXISTENT\\_KEY — Achievement not found.',
      );
    });

    it('BREAK: members pressing staff buttons or forging staff modals change nothing', async () => {
      const target = await bot.member({ roles: ['verified'] });
      const intruder = await bot.member({ roles: ['verified'] });
      const memberId = target.actor.memberId!;
      for (const action of ['award', 'revoke', 'verify']) {
        const pressed = await bot.run({
          kind: 'button',
          name: customId('achievements', action, memberId),
          user: intruder.user,
        });
        expect(pressed.interaction.lastText()).toContain('ACCESS RESTRICTED');
        expect(pressed.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      }
      const picked = await bot.run({
        kind: 'select',
        name: customId('achievements', 'verify_pick', memberId),
        user: intruder.user,
        values: ['team_leader'],
      });
      expect(picked.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await bot.run({
        kind: 'modal',
        name: customId('achievements', 'award', intruder.actor.memberId!),
        user: intruder.user,
        modalSelect: { achievement: ['relentless'] },
        modalText: { reason: 'I deserve it.' },
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const slash = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'award',
        user: intruder.user,
        options: { member: intruder.user, achievement: 'keystone', reason: 'Trust me.' },
      });
      expect(slash.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(await heldKeys(intruder.actor.memberId!)).toEqual([]);
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'access.denied'));
      expect(denials.length).toBeGreaterThan(0);
    });

    it('BREAK: staff cannot award themselves, and injection-shaped input is inert', async () => {
      const self = await bot.run({
        kind: 'slash',
        name: 'achievements',
        subcommand: 'award',
        user: ops.user,
        options: { member: ops.user, achievement: 'keystone', reason: 'Self-service.' },
      });
      expect(self.interaction.lastText()).toContain('cannot award your own');
      const target = await bot.member({ roles: ['verified'] });
      const injected = await bot.run({
        kind: 'modal',
        name: customId('achievements', 'award', target.actor.memberId!),
        user: ops.user,
        modalSelect: { achievement: ["team_leader'; drop table members; --"] },
        modalText: { reason: '@everyone <@&123456789012345678> look' },
      });
      expect(injected.interaction.lastText()).toContain('INVALID INPUT');
      expect(await heldKeys(target.actor.memberId!)).toEqual([]);
    });
  });
});
