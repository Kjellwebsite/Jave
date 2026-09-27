import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentType } from 'discord.js';
import { eq } from 'drizzle-orm';
import { tickets as ticketsTable } from '@jave/database';
import { updateSettings } from '@jave/core';
import type { BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import { MEMBER_TICKETS_MENU } from './context-menu';
import { HOOK_TIMEOUT, openViaDiscord, person, SUITE, textOf, ticketBot } from './test-support';

/** Finding tickets: typed numbers, archived history, and refusing an open before the form. */
describe('tickets — lookup, history and the open preflight', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  async function archive(ticketId: string, user: Parameters<typeof bot.run>[0]['user']) {
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticketId),
      user,
      modalText: { [FIELD.reason]: 'Resolved long ago.' },
    });
    // What the archive sweep does after archiveAfterDays.
    await bot.kit.db
      .update(ticketsTable)
      .set({ status: 'archived' })
      .where(eq(ticketsTable.id, ticketId));
  }

  function choicesOf(response: unknown): unknown[] {
    return response && typeof response === 'object' && 'choices' in response
      ? (response.choices as unknown[])
      : [];
  }

  it('a typed number finds that exact ticket in any status, within the caller scope', async () => {
    const requester = await person(bot, ['verified']);
    const stranger = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const old = await openViaDiscord(bot, requester.user, { subject: 'Old profile question' });
    await archive(old.id, requester.user);

    const complete = await bot.run({
      kind: 'autocomplete',
      name: 'ticket',
      user: staff.user,
      focused: { name: 'ticket', value: '1' },
    });
    expect(choicesOf(complete.interaction.responses[0])).toEqual([
      { name: '#0001 · Old profile question', value: old.id },
    ]);

    const typed = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: staff.user,
      options: { ticket: '#0001' },
    });
    expect(typed.interaction.lastText()).toContain('#0001');
    expect(typed.interaction.lastText()).toContain('ARCHIVED');

    const probe = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: stranger.user,
      options: { ticket: '1' },
    });
    expect(probe.interaction.lastText()).toContain('Choose a ticket from the list.');
    const strangerComplete = await bot.run({
      kind: 'autocomplete',
      name: 'ticket',
      user: stranger.user,
      focused: { name: 'ticket', value: '#0001' },
    });
    expect(choicesOf(strangerComplete.interaction.responses[0])).toEqual([]);
  });

  it('Member tickets and /ticket mine include archived tickets and link to the full history', async () => {
    const requester = await person(bot, ['verified'], 'orion');
    const staff = await person(bot, ['moderator']);
    const old = await openViaDiscord(bot, requester.user, { subject: 'Last quarter issue' });
    await archive(old.id, requester.user);
    await openViaDiscord(bot, requester.user, { subject: 'New issue today' });

    const menu = await bot.run({
      kind: 'user_context',
      name: MEMBER_TICKETS_MENU,
      user: staff.user,
      targetUser: requester.user,
    });
    const payload = menu.interaction.lastPayload()!;
    expect(textOf(payload)).toContain('Last quarter issue');
    expect(textOf(payload)).toContain('ARCHIVED');
    expect(textOf(payload)).toContain('New issue today');
    const [select, links] = payload.components!;
    expect(select!.components[0]).toMatchObject({
      type: ComponentType.StringSelect,
      placeholder: 'View a ticket',
    });
    const link = links!.components[0]!;
    expect(link).toMatchObject({ type: ComponentType.Button, label: 'FULL HISTORY' });
    const url = new URL('url' in link ? String(link.url) : '');
    expect(url.origin).toBe('https://jave.test');
    expect(url.pathname).toBe('/tickets');
    expect(url.searchParams.get('opener')).toBe(requester.actor.userId);
    expect(url.searchParams.get('status')).toBe('all');

    const mine = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'mine',
      user: requester.user,
    });
    expect(mine.interaction.lastText()).toContain('Last quarter issue');
    expect(mine.interaction.lastPayload()!.components![0]!.components[0]).toMatchObject({
      placeholder: 'View a ticket',
    });
  });

  it('the open limit and the hourly limit refuse before the form, not after it', async () => {
    const requester = await person(bot, ['verified']);
    await updateSettings(bot.kit.system, 'tickets', { maxOpenPerUser: 1, openRatePerHour: 2 });
    const first = await openViaDiscord(bot, requester.user);

    const fromPanel = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user: requester.user,
      values: ['general'],
    });
    expect(fromPanel.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
    expect(fromPanel.interaction.lastText()).toContain('You already have 1 open ticket (limit 1)');
    const fromCommand = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'open',
      user: requester.user,
    });
    expect(fromCommand.interaction.lastText()).toContain('limit 1');

    // Refusals before the form never spend the hourly budget: one more open fits.
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, first.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'Sorted it out.' },
    });
    const second = await openViaDiscord(bot, requester.user);
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, second.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'Sorted again.' },
    });
    const limited = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user: requester.user,
      values: ['general'],
    });
    expect(limited.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
    expect(limited.interaction.lastText()).toContain('RATE LIMITED');
  });
});
