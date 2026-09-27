import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, securityEvents } from '@jave/database';
import { getSettings, updateSettings } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { FakeInteractionInit } from '../../testing/fake-interaction';
import type { InteractionUser } from '../../interactions/types';
import {
  ALERT_CHANNEL_ID,
  CHAT_CHANNEL_ID,
  casesFor,
  configureModeration,
  customIdsOf,
  MEMBER_ROLE_ID,
  modalOf,
  QUARANTINE_ROLE_ID,
  selectOptions,
  targetMessage,
} from './test-support';

const INTERACTION_GAP_MS = 1000;
const HOUR_MS = 3_600_000;

describe('moderation feature — commands and flows', () => {
  let bot: BotHarness;

  beforeEach(async () => {
    bot = await createBotHarness();
    await configureModeration(bot);
  });
  afterEach(async () => {
    await bot.close();
  });

  /** Space interactions out so the router's per-user budget never trips. */
  const run = (init: Omit<FakeInteractionInit, 'user'> & { user: InteractionUser }) => {
    bot.kit.clock.advance(INTERACTION_GAP_MS);
    return bot.run(init);
  };

  const staff = (role: 'moderator' | 'operations' | 'core' = 'moderator') =>
    bot.member({ roles: [role], username: `${role}-${Math.random().toString(36).slice(2, 7)}` });

  describe('/mod warn', () => {
    it('warns with a typed reason, DMs the member and marks the case applied', async () => {
      const mod = await staff();
      const target = await bot.member({ username: 'nova' });
      const { interaction } = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'warn',
        user: mod.user,
        options: { member: target.user, reason: 'Spamming links in general' },
      });
      expect(interaction.responses[0]).toEqual({ type: 'defer', ephemeral: true });
      expect(interaction.lastText()).toContain('WARNING ISSUED — CASE-0001');
      expect(interaction.lastPayload()?.ephemeral).toBe(true);

      const [dm] = bot.gateway.dms;
      expect(dm?.userId).toBe(target.user.id);
      expect(dm?.payload.embeds?.[0]?.title).toContain('WARNING ISSUED');
      expect(dm?.payload.embeds?.[0]?.footer?.text).toContain('CASE-0001');
      const [record] = await casesFor(bot, target.actor.userId);
      expect(record).toMatchObject({ action: 'warn', discordSync: 'applied' });
    });

    it('opens a reason form when no reason is given', async () => {
      const mod = await staff();
      const target = await bot.member();
      const open = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'warn',
        user: mod.user,
        options: { member: target.user },
      });
      const modal = modalOf(open.interaction.responses);
      expect(modal?.custom_id).toBe(`moderation:act-submit:warn:${target.user.id}`);
      const submit = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Rule 3: no spam' },
      });
      expect(submit.interaction.lastText()).toContain('WARNING ISSUED');
      expect(await casesFor(bot, target.actor.userId)).toHaveLength(1);
    });
  });

  describe('/mod timeout', () => {
    it('applies a preset duration in Discord', async () => {
      const mod = await staff();
      const target = await bot.member();
      const { interaction } = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        options: { member: target.user, duration: '1h', reason: 'Cool down' },
      });
      expect(interaction.lastText()).toContain('TIMED OUT — CASE-0001');
      expect(interaction.lastText()).toContain('1H');
      const until = bot.gateway.members.get(target.user.id)?.timedOutUntil;
      expect(until?.getTime()).toBe(bot.kit.clock.now().getTime() + HOUR_MS);
      // The notice DM precedes the timeout.
      const methods = bot.gateway.calls.map((c) => c.method);
      expect(methods.indexOf('sendDirectMessage')).toBeLessThan(methods.indexOf('timeout'));
    });

    it('autocompletes presets and offers a typed custom duration first', async () => {
      const mod = await staff();
      const presets = await run({
        kind: 'autocomplete',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        focused: { name: 'duration', value: '' },
      });
      const first = presets.interaction.responses[0];
      const values = first && 'choices' in first ? first.choices.map((c) => c.value) : [];
      expect(values).toEqual(['10m', '1h', '1d', '7d', '28d']);
      const custom = await run({
        kind: 'autocomplete',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        focused: { name: 'duration', value: '2h30m' },
      });
      const response = custom.interaction.responses[0];
      expect(response && 'choices' in response ? response.choices[0]?.value : null).toBe('2h30m');
    });

    it('asks for a duration when only the reason is given, then uses the picked one', async () => {
      const mod = await staff();
      const target = await bot.member();
      const open = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        options: { member: target.user, reason: 'Heated thread' },
      });
      const modal = modalOf(open.interaction.responses);
      expect(JSON.stringify(modal)).toContain('"custom_id":"duration"');
      await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Heated thread' },
        modalSelect: { duration: ['10m'] },
      });
      const [record] = await casesFor(bot, target.actor.userId);
      expect(record?.durationSeconds).toBe(600);
    });

    it('refuses durations beyond Discord’s 28-day limit', async () => {
      const mod = await staff();
      const target = await bot.member();
      const { interaction } = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        options: { member: target.user, duration: '29d', reason: 'Too long' },
      });
      expect(interaction.lastText()).toContain('INVALID INPUT');
      expect(interaction.lastText()).toContain('28 days');
      expect(await casesFor(bot, target.actor.userId)).toHaveLength(0);
    });
  });

  describe('/mod kick and ban need confirmation', () => {
    it('kicks only after CONFIRM, DMing first', async () => {
      const mod = await staff();
      const target = await bot.member({ username: 'rowdy' });
      const start = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'kick',
        user: mod.user,
        options: { member: target.user, reason: 'Repeated harassment' },
      });
      expect(start.interaction.lastText()).toContain('CONFIRM KICK');
      const [confirmId, cancelId] = customIdsOf(start.interaction.lastPayload());
      expect(confirmId).toMatch(/^moderation:confirm:/);
      expect(cancelId).toMatch(/^moderation:cancel:/);
      expect(await casesFor(bot, target.actor.userId)).toHaveLength(0);

      const confirm = await run({ kind: 'button', name: confirmId!, user: mod.user });
      expect(confirm.interaction.responses[0]?.type).toBe('update');
      expect(confirm.interaction.lastText()).toContain('KICKED — CASE-0001');
      expect(customIdsOf(confirm.interaction.lastPayload())).not.toContain(confirmId);
      const methods = bot.gateway.calls.map((c) => c.method);
      expect(methods.indexOf('sendDirectMessage')).toBeLessThan(methods.indexOf('kick'));
      expect(bot.gateway.members.has(target.user.id)).toBe(false);
    });

    it('CANCEL records nothing', async () => {
      const mod = await staff();
      const target = await bot.member();
      const start = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'kick',
        user: mod.user,
        options: { member: target.user, reason: 'Changed my mind' },
      });
      const [, cancelId] = customIdsOf(start.interaction.lastPayload());
      const cancel = await run({ kind: 'button', name: cancelId!, user: mod.user });
      expect(cancel.interaction.lastText()).toContain('CANCELLED');
      expect(await casesFor(bot, target.actor.userId)).toHaveLength(0);
      expect(bot.gateway.callsTo('kick')).toHaveLength(0);
    });

    it('bans from the form with message deletion, then lifts the ban from autocomplete', async () => {
      const core = await staff('core');
      const target = await bot.member({ username: 'raider' });
      const open = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'ban',
        user: core.user,
        options: { member: target.user },
      });
      const modal = modalOf(open.interaction.responses);
      expect(JSON.stringify(modal)).toContain('"custom_id":"deleteMessages"');
      const submitted = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: core.user,
        modalText: { reason: 'Raid participant' },
        modalSelect: { deleteMessages: ['7'] },
      });
      expect(submitted.interaction.lastText()).toContain('CONFIRM BAN');
      expect(submitted.interaction.lastText()).toContain('Delete the last 7d');
      const [confirmId] = customIdsOf(submitted.interaction.lastPayload());
      await run({ kind: 'button', name: confirmId!, user: core.user });
      const [ban] = bot.gateway.callsTo('ban');
      expect(ban?.args).toEqual([
        target.user.id,
        expect.objectContaining({ deleteMessageSeconds: 7 * 86_400 }),
      ]);
      expect(bot.gateway.bans.has(target.user.id)).toBe(true);

      const choices = await run({
        kind: 'autocomplete',
        name: 'mod',
        subcommand: 'unban',
        user: core.user,
        focused: { name: 'user', value: 'raid' },
      });
      const response = choices.interaction.responses[0];
      expect(response && 'choices' in response ? response.choices[0]?.value : null).toBe(
        target.user.id,
      );
      const unban = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'unban',
        user: core.user,
        options: { user: target.user.id, reason: 'Appeal accepted' },
      });
      expect(unban.interaction.lastText()).toContain('BAN LIFTED');
      expect(bot.gateway.bans.has(target.user.id)).toBe(false);
    });
  });

  describe('/mod quarantine and release', () => {
    it('adds the quarantine role, strips managed roles, and release reverses it', async () => {
      const mod = await staff();
      const target = await bot.member();
      bot.gateway.members.get(target.user.id)!.roleIds.push(MEMBER_ROLE_ID);
      const quarantine = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'quarantine',
        user: mod.user,
        options: { member: target.user, reason: 'Compromised account suspected' },
      });
      expect(quarantine.interaction.lastText()).toContain('QUARANTINED');
      expect(bot.gateway.members.get(target.user.id)!.roleIds).toEqual([QUARANTINE_ROLE_ID]);
      const [member] = await bot.kit.db
        .select()
        .from(members)
        .where(eq(members.id, target.actor.memberId!));
      expect(member?.standing).toBe('quarantined');

      await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'release',
        user: mod.user,
        options: { member: target.user, reason: 'Owner verified by staff' },
      });
      await bot.drain();
      expect(bot.gateway.members.get(target.user.id)!.roleIds).not.toContain(QUARANTINE_ROLE_ID);
      expect(bot.gateway.members.get(target.user.id)!.roleIds).toContain(MEMBER_ROLE_ID);
    });

    it('falls back to a Discord timeout when no quarantine role is configured', async () => {
      await updateSettings(bot.kit.system, 'roles', { quarantineRoleId: undefined });
      const mod = await staff();
      const target = await bot.member();
      await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'quarantine',
        user: mod.user,
        options: { member: target.user, duration: '1d', reason: 'Hold for review' },
      });
      const [timeout] = bot.gateway.callsTo('timeout');
      expect((timeout?.args[1] as Date).getTime()).toBe(
        bot.kit.clock.now().getTime() + 24 * HOUR_MS,
      );
      expect(bot.gateway.callsTo('addRoles')).toHaveLength(0);
    });
  });

  it('/mod note is private and touches nothing in Discord', async () => {
    const mod = await staff();
    const target = await bot.member();
    const { interaction } = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'note',
      user: mod.user,
      options: { member: target.user, reason: 'Asked about rule 4, seemed genuine' },
    });
    expect(interaction.lastText()).toContain('NOTE ADDED');
    expect(bot.gateway.dms).toHaveLength(0);
    const [record] = await casesFor(bot, target.actor.userId);
    expect(record?.discordSync).toBe('not_required');
  });

  describe('/mod case and /mod history', () => {
    it('finds a case by number, shows its Discord sync state and revokes it', async () => {
      const mod = await staff();
      const target = await bot.member();
      await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'timeout',
        user: mod.user,
        options: { member: target.user, duration: '1d', reason: 'Flooding' },
      });
      const auto = await run({
        kind: 'autocomplete',
        name: 'mod',
        subcommand: 'case',
        user: mod.user,
        focused: { name: 'case', value: 'CASE-1' },
      });
      const response = auto.interaction.responses[0];
      const caseId = response && 'choices' in response ? response.choices[0]?.value : undefined;
      expect(response && 'choices' in response ? response.choices[0]?.name : '').toContain(
        'CASE-0001',
      );
      const view = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'case',
        user: mod.user,
        options: { case: caseId! },
      });
      expect(view.interaction.lastText()).toContain('CASE-0001 — TIMEOUT');
      expect(view.interaction.lastText()).toContain('APPLIED ✓');
      expect(view.interaction.lastText()).toContain('IN FORCE');
      const [revokeId] = customIdsOf(view.interaction.lastPayload());
      expect(revokeId).toBe(`moderation:case-revoke:${caseId}`);

      const byNumber = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'case',
        user: mod.user,
        options: { case: '1' },
      });
      expect(byNumber.interaction.lastText()).toContain('CASE-0001');

      const openRevoke = await run({ kind: 'button', name: revokeId!, user: mod.user });
      const modal = modalOf(openRevoke.interaction.responses);
      expect(modal?.title).toBe('REVOKE CASE-0001');
      const revoked = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Issued in error' },
      });
      expect(revoked.interaction.lastText()).toContain('CASE-0001 REVOKED');
      expect(revoked.interaction.lastText()).toContain('Lifted through CASE-0002');
      expect(bot.gateway.members.get(target.user.id)?.timedOutUntil).toBeNull();
    });

    it('history lists cases, opens one, and offers only the actions the viewer holds', async () => {
      const mod = await staff();
      const target = await bot.member({ username: 'drifter' });
      await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'warn',
        user: mod.user,
        options: { member: target.user, reason: 'Off-topic spam' },
      });
      const history = await run({
        kind: 'slash',
        name: 'mod',
        subcommand: 'history',
        user: mod.user,
        options: { member: target.user },
      });
      expect(history.interaction.lastText()).toContain('WARNINGS 1');
      expect(history.interaction.lastText()).toContain('CASE-0001');
      const actions = selectOptions(history.interaction.lastPayload(), 'moderation:act:');
      expect(actions.map((a) => a.value)).toEqual([
        'warn',
        'timeout',
        'quarantine',
        'kick',
        'note',
      ]);

      const cases = selectOptions(history.interaction.lastPayload(), 'moderation:case-open:');
      const opened = await run({
        kind: 'select',
        name: `moderation:case-open:${target.user.id}`,
        user: mod.user,
        values: [cases[0]!.value],
      });
      expect(opened.interaction.lastText()).toContain('CASE-0001 — WARNING');

      const picked = await run({
        kind: 'select',
        name: `moderation:act:${target.user.id}`,
        user: mod.user,
        values: ['timeout'],
      });
      expect(modalOf(picked.interaction.responses)?.custom_id).toBe(
        `moderation:act-submit:timeout:${target.user.id}`,
      );
    });
  });

  describe('context menus', () => {
    it('Moderation history and Quarantine work from a right-click', async () => {
      const mod = await staff();
      const target = await bot.member({ username: 'suspect' });
      const history = await run({
        kind: 'user_context',
        name: 'Moderation history',
        user: mod.user,
        targetUser: target.user,
      });
      expect(history.interaction.lastText()).toContain('No moderation cases on record.');

      const open = await run({
        kind: 'user_context',
        name: 'Quarantine',
        user: mod.user,
        targetUser: target.user,
      });
      const modal = modalOf(open.interaction.responses);
      expect(modal?.custom_id).toBe(`moderation:act-submit:quarantine:${target.user.id}`);
      await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Phishing DMs reported by members' },
        modalSelect: { duration: ['7d'] },
      });
      const [record] = await casesFor(bot, target.actor.userId);
      expect(record).toMatchObject({ action: 'quarantine', durationSeconds: 7 * 86_400 });
    });

    it('Report message files a confidential report and posts the staff card', async () => {
      const reporter = await bot.member({ username: 'witness' });
      const author = await bot.member({ username: 'scammer' });
      const message = targetMessage(author.user, 'free nitro https://discord-gift.example/claim');
      const { interaction } = await run({
        kind: 'message_context',
        name: 'Report message',
        user: reporter.user,
        targetMessage: message,
      });
      expect(interaction.lastText()).toContain('REPORT RECEIVED');
      expect(interaction.lastPayload()?.ephemeral).toBe(true);
      const [event] = await bot.kit.db.select().from(securityEvents);
      expect(event).toMatchObject({ trigger: 'manual_report', source: 'manual' });
      expect(event?.evidence.excerpt).toContain('free nitro');
      const [post] = bot.gateway.callsTo('sendMessage');
      expect(post?.args[0]).toBe(ALERT_CHANNEL_ID);
      const card = post?.args[1] as { components?: unknown[]; embeds?: { title?: string }[] };
      expect(card.embeds?.[0]?.title).toContain('MANUAL REPORT');
      expect(customIdsOf(card)).toEqual([
        `moderation:sec-ack:${event!.id}`,
        `moderation:sec-dismiss:${event!.id}`,
        `moderation:sec-q:${event!.id}`,
      ]);
      const [stored] = await bot.kit.db.select().from(securityEvents);
      expect(stored?.alertMessageId).toBeTruthy();

      // A second report of the same message gets the same reply and raises nothing new.
      const other = await bot.member();
      const again = await run({
        kind: 'message_context',
        name: 'Report message',
        user: other.user,
        targetMessage: message,
      });
      expect(again.interaction.lastText()).toContain('REPORT RECEIVED');
      expect(await bot.kit.db.select().from(securityEvents)).toHaveLength(1);
    });

    it('Delete & warn deletes the message, warns the author and keeps the excerpt', async () => {
      const mod = await staff();
      const author = await bot.member({ username: 'flooder' });
      const message = targetMessage(author.user, 'buy followers at cheap-followers.example');
      const open = await run({
        kind: 'message_context',
        name: 'Delete & warn',
        user: mod.user,
        targetMessage: message,
      });
      const modal = modalOf(open.interaction.responses);
      expect(modal?.custom_id).toMatch(/^moderation:dw-submit:/);
      const submit = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'Advertising' },
      });
      expect(submit.interaction.lastText()).toContain('WARNING ISSUED — CASE-0001');
      expect(submit.interaction.lastText()).toContain('Message deleted.');
      expect(bot.gateway.callsTo('deleteMessage')[0]?.args.slice(0, 2)).toEqual([
        CHAT_CHANNEL_ID,
        message.id,
      ]);
      const records = await casesFor(bot, author.actor.userId);
      const note = records.find((r) => r.action === 'note');
      expect(note?.reason).toContain('buy followers');
      expect(records.find((r) => r.action === 'warn')?.discordSync).toBe('applied');
    });
  });

  describe('security alert card buttons', () => {
    async function reportedEvent() {
      const reporter = await bot.member();
      const author = await bot.member({ username: 'phisher' });
      await run({
        kind: 'message_context',
        name: 'Report message',
        user: reporter.user,
        targetMessage: targetMessage(author.user, 'verify your account at steamcommunnity.example'),
      });
      const [event] = await bot.kit.db.select().from(securityEvents);
      return { event: event!, author };
    }

    it('ACKNOWLEDGE then QUARANTINE: reviews, acts, and refreshes the card', async () => {
      const { event, author } = await reportedEvent();
      const mod = await staff();
      const ack = await run({
        kind: 'button',
        name: `moderation:sec-ack:${event.id}`,
        user: mod.user,
      });
      expect(ack.interaction.lastText()).toContain('SEC-0001 ACKNOWLEDGED');
      const [edit] = bot.gateway.callsTo('editMessage');
      expect(customIdsOf(edit?.args[2] as { components?: unknown[] })).toEqual([
        `moderation:sec-dismiss:${event.id}`,
        `moderation:sec-q:${event.id}`,
      ]);

      const open = await run({
        kind: 'button',
        name: `moderation:sec-q:${event.id}`,
        user: mod.user,
      });
      const modal = modalOf(open.interaction.responses);
      expect(JSON.stringify(modal)).toContain('SEC-0001');
      await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: mod.user,
        modalText: { reason: 'SEC-0001 phishing link' },
        modalSelect: { duration: ['indefinite'] },
      });
      const [record] = await casesFor(bot, author.actor.userId);
      expect(record).toMatchObject({ action: 'quarantine', securityEventId: event.id });
      const [reviewed] = await bot.kit.db.select().from(securityEvents);
      expect(reviewed?.status).toBe('actioned');
      const edits = bot.gateway.callsTo('editMessage');
      expect(customIdsOf(edits.at(-1)?.args[2] as { components?: unknown[] })).toEqual([]);
    });

    it('DISMISS removes the buttons', async () => {
      const { event } = await reportedEvent();
      const mod = await staff();
      await run({ kind: 'button', name: `moderation:sec-dismiss:${event.id}`, user: mod.user });
      const edits = bot.gateway.callsTo('editMessage');
      const card = edits.at(-1)?.args[2] as {
        components?: unknown[];
        embeds?: { footer?: { text?: string } }[];
      };
      expect(customIdsOf(card)).toEqual([]);
      expect(card.embeds?.[0]?.footer?.text).toContain('DISMISSED');
    });
  });

  describe('/raidmode', () => {
    it('switches raid mode on and off, posting one notice each time', async () => {
      const core = await staff('core');
      const on = await run({
        kind: 'slash',
        name: 'raidmode',
        subcommand: 'on',
        user: core.user,
        options: { reason: 'Join burst from a known raid server' },
      });
      expect(on.interaction.lastText()).toContain('RAID MODE — ON');
      expect((await getSettings(bot.kit.system, 'security')).raidMode).toBe(true);
      const notices = () =>
        bot.gateway
          .callsTo('sendMessage')
          .filter((c) => c.args[0] === ALERT_CHANNEL_ID)
          .map((c) => (c.args[1] as { embeds: { title: string }[] }).embeds[0]!.title);
      expect(notices()).toEqual(['RAID MODE — ON']);

      const status = await run({
        kind: 'slash',
        name: 'raidmode',
        subcommand: 'status',
        user: core.user,
      });
      expect(status.interaction.lastText()).toContain('RAID MODE ON');

      const open = await run({
        kind: 'slash',
        name: 'raidmode',
        subcommand: 'off',
        user: core.user,
      });
      const modal = modalOf(open.interaction.responses);
      expect(modal?.custom_id).toBe('moderation:raid-submit:off');
      const off = await run({
        kind: 'modal',
        name: modal!.custom_id,
        user: core.user,
        modalText: { reason: 'Burst over' },
      });
      expect(off.interaction.lastText()).toContain('RAID MODE — OFF');
      expect(notices()).toEqual(['RAID MODE — ON', 'RAID MODE — OFF']);
    });
  });
});
