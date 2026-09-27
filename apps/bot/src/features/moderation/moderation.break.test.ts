import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, members, modCases, securityEvents } from '@jave/database';
import { getSettings } from '@jave/core';
import type { FakeInteractionInit } from '../../testing/fake-interaction';
import { createBotHarness, type BotHarness, discordUser } from '../../testing/harness';
import type { InteractionUser } from '../../interactions/types';
import { PENDING_TTL_MS } from './pending';
import { casesFor, configureModeration, customIdsOf, modalOf, targetMessage } from './test-support';

const INTERACTION_GAP_MS = 1000;
const FORGED_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * BREAK: adversarial use of the moderation surface. Custom ids are routing
 * hints, never authority; every refusal must leave JAVE and Discord untouched.
 */
describe('BREAK: moderation surface', () => {
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

  const allCases = () => bot.kit.db.select().from(modCases);
  const discordWrites = () =>
    bot.gateway.calls.filter((c) => !['fetchMember', 'sendDirectMessage'].includes(c.method));

  async function reportedEvent() {
    const reporter = await bot.member({ username: 'witness' });
    const author = await bot.member({ username: 'phisher' });
    await run({
      kind: 'message_context',
      name: 'Report message',
      user: reporter.user,
      targetMessage: targetMessage(author.user, 'claim your prize at nitro-gift.example'),
    });
    const [event] = await bot.kit.db.select().from(securityEvents);
    return { event: event!, reporter, author };
  }

  it('members cannot run /mod, staff context menus or /raidmode', async () => {
    const member = await bot.member({ username: 'curious' });
    const target = await bot.member();
    const attempts: (Omit<FakeInteractionInit, 'user'> & { user: InteractionUser })[] = [
      {
        kind: 'slash',
        name: 'mod',
        subcommand: 'ban',
        user: member.user,
        options: { member: target.user, reason: 'no reason at all' },
      },
      {
        kind: 'user_context',
        name: 'Moderation history',
        user: member.user,
        targetUser: target.user,
      },
      { kind: 'user_context', name: 'Quarantine', user: member.user, targetUser: target.user },
      {
        kind: 'message_context',
        name: 'Delete & warn',
        user: member.user,
        targetMessage: targetMessage(target.user, 'hello'),
      },
      {
        kind: 'slash',
        name: 'raidmode',
        subcommand: 'on',
        user: member.user,
        options: { reason: 'chaos' },
      },
    ];
    for (const attempt of attempts) {
      const { interaction } = await run(attempt);
      expect(interaction.lastText(), attempt.name).toContain('ACCESS RESTRICTED');
      expect(modalOf(interaction.responses)).toBeNull();
    }
    expect(await allCases()).toHaveLength(0);
    expect((await getSettings(bot.kit.system, 'security')).raidMode).toBe(false);
    expect(discordWrites()).toHaveLength(0);
  });

  it('member autocomplete on /mod reveals nothing and cannot flood the audit log', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const member = await bot.member({ username: 'prober' });
    const target = await bot.member();
    await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'note',
      user: mod.user,
      options: { member: target.user, reason: 'Private staff context.' },
    });
    const auditRows = async () => (await bot.kit.db.select().from(auditLogs)).length;
    const before = await auditRows();
    for (const [subcommand, name, value] of [
      ['case', 'case', 'CASE-1'],
      ['case', 'case', 'private'],
      ['unban', 'user', ''],
      ['timeout', 'duration', '1h'],
    ] as const) {
      const { interaction } = await bot.run({
        kind: 'autocomplete',
        name: 'mod',
        subcommand,
        user: member.user,
        focused: { name, value },
      });
      expect(interaction.responses).toEqual([{ type: 'autocomplete', choices: [] }]);
    }
    expect(await auditRows()).toBe(before);
  });

  it('a moderator is refused BAN before any form or confirmation (canBanMembers)', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const target = await bot.member();
    const typed = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'ban',
      user: mod.user,
      options: { member: target.user, reason: 'Ban evasion' },
    });
    expect(typed.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(customIdsOf(typed.interaction.lastPayload())).toEqual([]);
    const form = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'ban',
      user: mod.user,
      options: { member: target.user },
    });
    expect(modalOf(form.interaction.responses)).toBeNull();
    // A forged modal submission and a forged "take action" pick are refused the same way.
    const forgedSubmit = await run({
      kind: 'modal',
      name: `moderation:act-submit:ban:${target.user.id}`,
      user: mod.user,
      modalText: { reason: 'Forged form' },
      modalSelect: { deleteMessages: ['7'] },
    });
    expect(forgedSubmit.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const forgedPick = await run({
      kind: 'select',
      name: `moderation:act:${target.user.id}`,
      user: mod.user,
      values: ['ban'],
    });
    expect(forgedPick.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(await allCases()).toHaveLength(0);
    expect(bot.gateway.callsTo('ban')).toHaveLength(0);
  });

  it('members pressing security alert buttons change nothing', async () => {
    const { event } = await reportedEvent();
    const member = await bot.member({ username: 'bystander' });
    const editsBefore = bot.gateway.callsTo('editMessage').length;
    for (const action of ['sec-ack', 'sec-dismiss', 'sec-q']) {
      const { interaction } = await run({
        kind: 'button',
        name: `moderation:${action}:${event.id}`,
        user: member.user,
      });
      expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(modalOf(interaction.responses)).toBeNull();
    }
    const forgedQuarantine = await run({
      kind: 'modal',
      name: `moderation:sec-q-submit:${event.id}`,
      user: member.user,
      modalText: { reason: 'Forged quarantine' },
      modalSelect: { duration: ['indefinite'] },
    });
    expect(forgedQuarantine.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const [after] = await bot.kit.db.select().from(securityEvents);
    expect(after?.status).toBe('open');
    expect(await allCases()).toHaveLength(0);
    expect(bot.gateway.callsTo('editMessage')).toHaveLength(editsBefore);
    const denials = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'access.denied'));
    expect(denials.length).toBeGreaterThan(0);
  });

  it('forged and malformed custom ids are refused as expired', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const names = [
      'moderation:sec-ack:not-a-uuid',
      'moderation:sec-dismiss:',
      'moderation:act:12345',
      'moderation:case-revoke:DROP TABLE',
      'moderation:history:<@everyone>',
      'moderation:confirm:x',
      'moderation:cancel:../../',
      'moderation:no-such-action:1',
    ];
    for (const name of names) {
      const { interaction } = await run({ kind: 'button', name, user: mod.user });
      expect(interaction.lastText(), name).toContain('EXPIRED');
    }
    const badModal = await run({
      kind: 'modal',
      name: 'moderation:act-submit:obliterate:123456789012345678',
      user: mod.user,
      modalText: { reason: 'Unknown action' },
    });
    expect(badModal.interaction.lastText()).toContain('EXPIRED');
    const badRaid = await run({
      kind: 'modal',
      name: 'moderation:raid-submit:maybe',
      user: mod.user,
      modalText: { reason: 'Unknown state' },
    });
    expect(badRaid.interaction.lastText()).toContain('EXPIRED');
    expect(await allCases()).toHaveLength(0);
  });

  it('a case id that does not exist reads as not found, never as an error', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const open = await run({
      kind: 'select',
      name: `moderation:case-open:${mod.user.id}`,
      user: mod.user,
      values: [FORGED_UUID],
    });
    expect(open.interaction.lastText()).toContain('NOT FOUND');
    const revoke = await run({
      kind: 'button',
      name: `moderation:case-revoke:${FORGED_UUID}`,
      user: mod.user,
    });
    expect(revoke.interaction.lastText()).toContain('NOT FOUND');
    expect(modalOf(revoke.interaction.responses)).toBeNull();
    const byNumber = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'case',
      user: mod.user,
      options: { case: 'CASE-99999999999' },
    });
    expect(byNumber.interaction.lastText()).toContain('NOT FOUND');
  });

  it('another moderator cannot confirm or cancel your kick; a used or stale token is dead', async () => {
    const first = await bot.member({ roles: ['moderator'], username: 'first' });
    const second = await bot.member({ roles: ['moderator'], username: 'second' });
    const target = await bot.member({ username: 'rowdy' });
    const start = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'kick',
      user: first.user,
      options: { member: target.user, reason: 'Repeated harassment' },
    });
    const [confirmId, cancelId] = customIdsOf(start.interaction.lastPayload());
    expect(confirmId).toMatch(/^moderation:confirm:/);

    const stolenConfirm = await run({ kind: 'button', name: confirmId!, user: second.user });
    expect(stolenConfirm.interaction.lastText()).toContain(
      'Only the moderator who started this action can confirm it.',
    );
    const stolenCancel = await run({ kind: 'button', name: cancelId!, user: second.user });
    expect(stolenCancel.interaction.lastText()).toContain(
      'Only the moderator who started this action can cancel it.',
    );
    expect(await allCases()).toHaveLength(0);

    // The issuer's token survived the stranger's cancel.
    await run({ kind: 'button', name: confirmId!, user: first.user });
    expect(await casesFor(bot, target.actor.userId)).toHaveLength(1);
    const replay = await run({ kind: 'button', name: confirmId!, user: first.user });
    expect(replay.interaction.lastText()).toContain('EXPIRED');
    expect(await allCases()).toHaveLength(1);

    const later = await bot.member();
    const again = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'kick',
      user: first.user,
      options: { member: later.user, reason: 'Spam wave' },
    });
    const [staleId] = customIdsOf(again.interaction.lastPayload());
    bot.kit.clock.advance(PENDING_TTL_MS);
    const stale = await run({ kind: 'button', name: staleId!, user: first.user });
    expect(stale.interaction.lastText()).toContain('This confirmation expired.');
    expect(await casesFor(bot, later.actor.userId)).toHaveLength(0);
  });

  it('moderators cannot act on themselves or on higher-ranked staff, nor read their records', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const ops = await bot.member({ roles: ['operations'], username: 'lead' });
    const self = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'warn',
      user: mod.user,
      options: { member: mod.user, reason: 'Testing myself' },
    });
    expect(self.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const up = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'timeout',
      user: mod.user,
      options: { member: ops.user, duration: '1h', reason: 'Overruling a superior' },
    });
    expect(up.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const history = await run({
      kind: 'user_context',
      name: 'Moderation history',
      user: mod.user,
      targetUser: ops.user,
    });
    expect(history.interaction.lastText()).toContain('NOT FOUND');
    expect(await allCases()).toHaveLength(0);
    expect(bot.gateway.callsTo('timeout')).toHaveLength(0);
  });

  it('Delete & warn on a higher-ranked author deletes nothing', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const core = await bot.member({ roles: ['core'], username: 'lead' });
    const message = targetMessage(core.user, 'Announcement draft');
    const open = await run({
      kind: 'message_context',
      name: 'Delete & warn',
      user: mod.user,
      targetMessage: message,
    });
    const modal = modalOf(open.interaction.responses);
    const submit = await run({
      kind: 'modal',
      name: modal!.custom_id,
      user: mod.user,
      modalText: { reason: 'Trying anyway' },
    });
    expect(submit.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(0);
    expect(await allCases()).toHaveLength(0);

    // Another moderator cannot reuse the first moderator's form token.
    const other = await bot.member({ roles: ['moderator'] });
    const reopen = await run({
      kind: 'message_context',
      name: 'Delete & warn',
      user: mod.user,
      targetMessage: targetMessage((await bot.member()).user, 'spam spam'),
    });
    const stolen = await run({
      kind: 'modal',
      name: modalOf(reopen.interaction.responses)!.custom_id,
      user: other.user,
      modalText: { reason: 'Not my form' },
    });
    expect(stolen.interaction.lastText()).toContain('EXPIRED');
    expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(0);
  });

  it('Report message: own messages, other servers and restricted reporters are refused', async () => {
    const reporter = await bot.member({ username: 'reporter' });
    const author = await bot.member({ username: 'author' });
    const own = await run({
      kind: 'message_context',
      name: 'Report message',
      user: reporter.user,
      targetMessage: targetMessage(reporter.user, 'my own words'),
    });
    expect(own.interaction.lastText()).toContain('You cannot report your own message.');
    const foreign = await run({
      kind: 'message_context',
      name: 'Report message',
      user: reporter.user,
      targetMessage: { ...targetMessage(author.user, 'elsewhere'), guildId: null },
    });
    expect(foreign.interaction.lastText()).toContain('inside JAVELIN only');

    await bot.kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.userId, reporter.actor.userId));
    const restrictedReport = await run({
      kind: 'message_context',
      name: 'Report message',
      user: reporter.user,
      targetMessage: targetMessage(author.user, 'anything'),
    });
    expect(restrictedReport.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(await bot.kit.db.select().from(securityEvents)).toHaveLength(0);
  });

  it('Report message is rate limited per reporter, so staff cannot be flooded', async () => {
    const reporter = await bot.member({ username: 'eager' });
    const author = await bot.member({ username: 'target' });
    const texts: string[] = [];
    for (let index = 0; index < 7; index++) {
      const { interaction } = await run({
        kind: 'message_context',
        name: 'Report message',
        user: reporter.user,
        targetMessage: targetMessage(author.user, `message ${index}`),
      });
      texts.push(interaction.lastText());
    }
    expect(texts.filter((text) => text.includes('REPORT RECEIVED'))).toHaveLength(5);
    expect(texts.at(-1)).toContain('RATE LIMITED');
    expect(await bot.kit.db.select().from(securityEvents)).toHaveLength(5);
  });

  it('user text in reasons and names cannot ping or format', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const target = await bot.member({ username: 'target' });
    const hostile = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'warn',
      user: mod.user,
      options: {
        member: target.user,
        reason: '@everyone **bold** <@&123456789012345678> [x](https://evil.example)',
      },
    });
    const text = hostile.interaction.lastText();
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@&123456789012345678>');
    expect(text).not.toContain('**bold**');
    const [dm] = bot.gateway.dms;
    expect(JSON.stringify(dm?.payload)).not.toContain('@everyone');
  });

  it('interactions from another guild never reach moderation', async () => {
    const mod = await bot.member({ roles: ['moderator'] });
    const stranger = discordUser('999999999999999999', 'stranger');
    const { interaction } = await run({
      kind: 'slash',
      name: 'mod',
      subcommand: 'warn',
      guildId: '123123123123123123',
      user: mod.user,
      options: { member: stranger, reason: 'Wrong server' },
    });
    expect(interaction.lastText()).toContain('UNAVAILABLE');
    expect(await allCases()).toHaveLength(0);
  });
});
