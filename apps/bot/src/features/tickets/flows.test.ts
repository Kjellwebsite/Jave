import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, notificationDeliveries, ticketMessages } from '@jave/database';
import { updateSettings } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { BotHarness } from '../../testing/harness';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import {
  ARCHIVE_CHANNEL_ID,
  customIdsOf,
  HOOK_TIMEOUT,
  messageState,
  openViaDiscord,
  person,
  postedTo,
  SUITE,
  TICKET_CHANNEL_ID,
  textOf,
  threadMessage,
  ticketBot,
  ticketRow,
} from './test-support';

describe('tickets — Discord flows', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  it('/ticket open: category select → form → private thread with the opener and a card', async () => {
    const requester = await person(bot, ['verified'], 'nova');
    const start = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'open',
      user: requester.user,
    });
    const prompt = start.interaction.lastPayload()!;
    expect(prompt.ephemeral).toBe(true);
    expect(customIdsOf(prompt)).toEqual([customId(TICKETS_NS, ACTION.category)]);

    const select = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user: requester.user,
      values: ['technical'],
    });
    const modal = select.interaction.responses[0];
    expect(modal?.type).toBe('modal');
    expect(modal && 'modal' in modal ? modal.modal.custom_id : '').toBe('tickets:open:technical');

    const ticket = await openViaDiscord(bot, requester.user, {
      subject: 'Dashboard login loops',
      body: 'Signing in returns me to /login. @everyone please help',
      priority: 'high',
    });
    const [thread] = bot.gateway.callsTo('createPrivateThread');
    expect(thread!.args[0]).toBe(TICKET_CHANNEL_ID);
    expect(thread!.args[1]).toMatchObject({ name: '#0001 · Dashboard login loops' });
    expect(bot.gateway.channels.get(ticket.threadId)!.members.has(requester.actor.discordId)).toBe(
      true,
    );

    const card = messageState(bot, ticket.cardMessageId);
    const text = textOf(card);
    expect(text).toContain('#0001 · OPEN');
    expect(text).toContain('HIGH');
    expect(text).toContain('Unassigned');
    expect(text).not.toContain('@everyone');
    expect(customIdsOf(card)).toEqual([
      customId(TICKETS_NS, ACTION.claim, ticket.id),
      customId(TICKETS_NS, ACTION.close, ticket.id),
    ]);
  });

  it('staff claim from the card: card updates, handler joins the thread, requester is told', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator'], 'ren');
    const ticket = await openViaDiscord(bot, requester.user);

    const claimed = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: staff.user,
      channelId: ticket.threadId,
    });
    expect(claimed.interaction.lastText()).toContain('CLAIMED #0001');
    expect(claimed.interaction.lastPayload()!.ephemeral).toBe(true);

    const card = messageState(bot, ticket.cardMessageId);
    expect(textOf(card)).toContain('#0001 · CLAIMED');
    expect(textOf(card)).toContain(`<@${staff.actor.discordId}>`);
    expect(customIdsOf(card)).toEqual([customId(TICKETS_NS, ACTION.close, ticket.id)]);
    expect(bot.gateway.channels.get(ticket.threadId)!.members.has(staff.actor.discordId)).toBe(
      true,
    );
    const lines = postedTo(bot, ticket.threadId).map(textOf);
    expect(lines).toContain('**CLAIMED** — ren is handling this ticket.');
    expect(bot.gateway.dms.some((dm) => dm.userId === requester.actor.discordId)).toBe(true);
  });

  it('context-aware staff commands inside the thread: priority, waiting, note, transfer', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator'], 'ren');
    const other = await person(bot, ['moderator'], 'kai');
    const ticket = await openViaDiscord(bot, requester.user);
    const inThread = { user: staff.user, channelId: ticket.threadId };

    const priority = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'priority',
      ...inThread,
    });
    expect(customIdsOf(priority.interaction.lastPayload()!)).toEqual([
      customId(TICKETS_NS, ACTION.priority, ticket.id),
    ]);
    const set = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.priority, ticket.id),
      values: ['urgent'],
      ...inThread,
    });
    expect(set.interaction.lastText()).toContain('URGENT');
    expect(textOf(messageState(bot, ticket.cardMessageId))).toContain('URGENT');

    const waitingForm = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'waiting',
      ...inThread,
    });
    expect(waitingForm.interaction.responses[0]?.type).toBe('modal');
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.waiting, ticket.id),
      modalText: { [FIELD.reason]: 'Send the full log from the failing run.' },
      ...inThread,
    });
    expect((await ticketRow(bot, ticket.id)).status).toBe('waiting');
    expect(postedTo(bot, ticket.threadId).map(textOf)).toContain(
      '**WAITING ON YOU** — Send the full log from the failing run.',
    );

    const note = 'Suspect the OOM killer; check the runner size.';
    await bot.run({ kind: 'slash', name: 'ticket', subcommand: 'note', ...inThread });
    const saved = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.note, ticket.id),
      modalText: { [FIELD.note]: note },
      ...inThread,
    });
    expect(saved.interaction.lastText()).toContain('INTERNAL NOTE ADDED');
    const everythingPosted = bot.gateway.calls.map((call) => JSON.stringify(call.args)).join('\n');
    expect(everythingPosted).not.toContain('OOM killer');
    const [stored] = await bot.kit.db
      .select()
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.isInternal, true)));
    expect(stored!.body).toBe(note);

    await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      ...inThread,
    });
    const picker = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'transfer',
      ...inThread,
    });
    expect(customIdsOf(picker.interaction.lastPayload()!)).toEqual([
      customId(TICKETS_NS, ACTION.transfer, ticket.id),
    ]);
    const moved = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.transfer, ticket.id),
      values: [other.actor.discordId],
      ...inThread,
    });
    expect(moved.interaction.lastText()).toContain('TRANSFERRED #0001');
    expect((await ticketRow(bot, ticket.id)).assigneeUserId).toBe(other.actor.userId);
    expect(bot.gateway.channels.get(ticket.threadId)!.members.has(other.actor.discordId)).toBe(
      true,
    );
  });

  it('requester reply resumes a waiting ticket; the listener records thread messages', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.waiting, ticket.id),
      user: staff.user,
      modalText: { [FIELD.reason]: 'Which browser?' },
    });
    await bot.app.events.message(threadMessage(ticket.threadId, requester.user, 'Firefox 140.'));
    await bot.settle();
    expect((await ticketRow(bot, ticket.id)).status).toBe('open');
    expect(textOf(messageState(bot, ticket.cardMessageId))).toContain('#0001 · OPEN');
  });

  it('close with a reason → closing card, final card, locked thread, archived transcript; reopen restores it', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.note, ticket.id),
      user: staff.user,
      modalText: { [FIELD.note]: 'Internal: requester was rude in DMs.' },
    });
    await bot.app.events.message(threadMessage(ticket.threadId, staff.user, 'Fixed on our side.'));
    await bot.settle();

    const form = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.close, ticket.id),
      user: requester.user,
      channelId: ticket.threadId,
    });
    expect(form.interaction.responses[0]?.type).toBe('modal');
    const closed = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticket.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'Works again, thank you.' },
    });
    expect(closed.interaction.lastText()).toContain('CLOSED #0001');

    const thread = bot.gateway.channels.get(ticket.threadId)!;
    expect(thread).toMatchObject({ locked: true, archived: true });
    expect(customIdsOf(messageState(bot, ticket.cardMessageId))).toEqual([]);
    const closing = postedTo(bot, ticket.threadId).find((m) =>
      textOf(m).includes('#0001 · CLOSED'),
    )!;
    expect(textOf(closing)).toContain('Works again, thank you.');
    expect(customIdsOf(closing)).toEqual([customId(TICKETS_NS, ACTION.reopen, ticket.id)]);

    const [archived] = postedTo(bot, ARCHIVE_CHANNEL_ID);
    const file = archived!.files![0]!;
    expect(file.name).toBe('ticket-0001.html');
    const html = file.data.toString('utf8');
    expect(html).toContain('Fixed on our side.');
    expect(html).not.toContain('requester was rude');

    await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.reopen, ticket.id),
      user: requester.user,
      channelId: ticket.threadId,
    });
    const reopened = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.reopen, ticket.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'It broke again.' },
    });
    expect(reopened.interaction.lastText()).toContain('REOPENED #0001');
    expect(thread).toMatchObject({ locked: false, archived: false });
    expect(postedTo(bot, ticket.threadId).map(textOf)).toContain('**REOPENED** — It broke again.');
    expect(customIdsOf(messageState(bot, ticket.cardMessageId))).toContain(
      customId(TICKETS_NS, ACTION.close, ticket.id),
    );
  });

  it('/ticket view shows staff data only to staff; /ticket mine lists your own', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    const own = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: requester.user,
      channelId: ticket.threadId,
    });
    expect(own.interaction.lastText()).toContain('#0001');
    expect(own.interaction.lastText()).not.toContain('FIRST RESPONSE');
    const staffView = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: staff.user,
      options: { ticket: ticket.id },
    });
    expect(staffView.interaction.lastText()).toContain('STAFF VIEW');
    expect(staffView.interaction.lastText()).toContain('FIRST RESPONSE');
    const mine = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'mine',
      user: requester.user,
    });
    expect(mine.interaction.lastText()).toContain('**#0001**');
    const none = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'mine',
      user: staff.user,
    });
    expect(none.interaction.lastText()).toContain('No tickets yet');
  });

  it('/ticket queue lists active tickets and claims from the select', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user, { priority: 'urgent' });
    const queue = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'queue',
      user: staff.user,
    });
    expect(queue.interaction.lastText()).toContain('**#0001** · URGENT · OPEN');
    expect(customIdsOf(queue.interaction.lastPayload()!)).toEqual([
      customId(TICKETS_NS, ACTION.queueClaim),
    ]);
    const claimed = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.queueClaim),
      user: staff.user,
      values: [ticket.id],
    });
    expect(claimed.interaction.lastText()).toContain('CLAIMED #0001');
  });

  it('autocompletes tickets by number and subject, scoped by core', async () => {
    const requester = await person(bot, ['verified']);
    const stranger = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user, { subject: 'Password reset' });
    const byNumber = await bot.run({
      kind: 'autocomplete',
      name: 'ticket',
      user: requester.user,
      focused: { name: 'ticket', value: '#1' },
    });
    const first = byNumber.interaction.responses[0];
    expect(first && 'choices' in first ? first.choices : []).toEqual([
      { name: '#0001 · Password reset', value: ticket.id },
    ]);
    const hidden = await bot.run({
      kind: 'autocomplete',
      name: 'ticket',
      user: stranger.user,
      focused: { name: 'ticket', value: 'password' },
    });
    const none = hidden.interaction.responses[0];
    expect(none && 'choices' in none ? none.choices : null).toEqual([]);
  });

  it('/ticket panel posts the public panel for ticket managers and is audited', async () => {
    const manager = await person(bot, ['operations']);
    const channelId = '300000000000000555';
    const posted = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'panel',
      user: manager.user,
      channelId,
    });
    expect(posted.interaction.lastText()).toContain('PANEL POSTED');
    const [panelMessage] = postedTo(bot, channelId);
    expect(textOf(panelMessage!)).toContain('OPEN A TICKET');
    expect(customIdsOf(panelMessage!)).toEqual([customId(TICKETS_NS, ACTION.category)]);
    const audit = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'ticket.panel_posted'));
    expect(audit).toHaveLength(1);
  });

  it('claim still works when the requester has DMs closed', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    bot.gateway.closedDms.add(requester.actor.discordId);
    const ticket = await openViaDiscord(bot, requester.user);
    const claimed = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: staff.user,
    });
    expect(claimed.interaction.lastText()).toContain('CLAIMED #0001');
    await bot.drain();
    const deliveries = await bot.kit.db.select().from(notificationDeliveries);
    expect(deliveries.some((d) => d.status === 'skipped')).toBe(true);
  });

  it('settings: tickets disabled or no ticket channel → clear refusal before the form', async () => {
    const requester = await person(bot, ['verified']);
    await updateSettings(bot.kit.system, 'channels', { tickets: undefined });
    const unconfigured = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user: requester.user,
      values: ['general'],
    });
    expect(unconfigured.interaction.lastText()).toContain('not set up yet');
    await updateSettings(bot.kit.system, 'channels', { tickets: TICKET_CHANNEL_ID });
    await updateSettings(bot.kit.system, 'tickets', { enabled: false });
    const disabled = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'open',
      user: requester.user,
    });
    expect(disabled.interaction.lastText()).toContain('DISABLED');
  });
});
