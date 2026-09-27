import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentType } from 'discord.js';
import type { BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import {
  customIdsOf,
  HOOK_TIMEOUT,
  openViaDiscord,
  person,
  SUITE,
  ticketBot,
  ticketRow,
} from './test-support';

const id = (action: string, ticketId: string) => customId(TICKETS_NS, action, ticketId);

/** MANAGE: the staff panel reached from the thread card and the staff /ticket view. */
describe('tickets — MANAGE panel', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  async function press(user: Parameters<typeof bot.run>[0]['user'], name: string) {
    return bot.run({ kind: 'button', name, user });
  }

  it('offers every handler action as buttons and selects, and each one works', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);

    const unassigned = await press(staff.user, id(ACTION.manage, ticket.id));
    const panel = unassigned.interaction.lastPayload()!;
    expect(panel.ephemeral).toBe(true);
    expect(unassigned.interaction.lastText()).toContain('MANAGE #0001');
    expect(customIdsOf(panel)).toEqual([
      id(ACTION.claim, ticket.id),
      id(ACTION.waiting, ticket.id),
      id(ACTION.note, ticket.id),
      id(ACTION.summary, ticket.id),
      id(ACTION.close, ticket.id),
      id(ACTION.priority, ticket.id),
    ]);

    await press(staff.user, id(ACTION.claim, ticket.id));
    const claimed = await press(staff.user, id(ACTION.manage, ticket.id));
    const claimedPanel = claimed.interaction.lastPayload()!;
    expect(customIdsOf(claimedPanel)).toEqual([
      id(ACTION.unclaim, ticket.id),
      id(ACTION.waiting, ticket.id),
      id(ACTION.note, ticket.id),
      id(ACTION.summary, ticket.id),
      id(ACTION.close, ticket.id),
      id(ACTION.priority, ticket.id),
      id(ACTION.transfer, ticket.id),
    ]);
    const picker = claimedPanel.components!.at(-1)!.components[0]!;
    expect(picker.type).toBe(ComponentType.UserSelect);

    const waitForm = await press(staff.user, id(ACTION.waiting, ticket.id));
    expect(waitForm.interaction.responses[0]?.type).toBe('modal');
    await bot.run({
      kind: 'modal',
      name: id(ACTION.waiting, ticket.id),
      user: staff.user,
      modalText: { [FIELD.reason]: 'Send the error output, please.' },
    });
    expect((await ticketRow(bot, ticket.id)).status).toBe('waiting');
    const waiting = await press(staff.user, id(ACTION.manage, ticket.id));
    expect(customIdsOf(waiting.interaction.lastPayload()!)).toContain(id(ACTION.resume, ticket.id));
    const resumed = await press(staff.user, id(ACTION.resume, ticket.id));
    expect(resumed.interaction.lastText()).toContain('RESUMED #0001');
    expect((await ticketRow(bot, ticket.id)).status).toBe('claimed');

    const noteForm = await press(staff.user, id(ACTION.note, ticket.id));
    expect(noteForm.interaction.responses[0]?.type).toBe('modal');

    const released = await press(staff.user, id(ACTION.unclaim, ticket.id));
    expect(released.interaction.lastText()).toContain('RELEASED #0001');
    expect(await ticketRow(bot, ticket.id)).toMatchObject({ status: 'open', assigneeUserId: null });
  });

  it('the staff /ticket view carries MANAGE; the requester view does not', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    const staffView = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: staff.user,
      options: { ticket: ticket.id },
    });
    expect(customIdsOf(staffView.interaction.lastPayload()!)).toEqual([
      id(ACTION.claim, ticket.id),
      id(ACTION.manage, ticket.id),
    ]);
    const ownView = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: requester.user,
      channelId: ticket.threadId,
    });
    expect(customIdsOf(ownView.interaction.lastPayload()!)).toEqual([]);
  });

  it('BREAK: the requester pressing MANAGE on the card gets a refusal, not the panel', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const { interaction } = await press(requester.user, id(ACTION.manage, ticket.id));
    expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(interaction.lastText()).not.toContain('MANAGE #0001');
    expect(customIdsOf(interaction.lastPayload()!)).toEqual([]);
    for (const action of [ACTION.unclaim, ACTION.resume, ACTION.waiting, ACTION.note]) {
      const forged = await press(requester.user, id(action, ticket.id));
      expect(forged.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      expect(forged.interaction.lastText()).toMatch(/ACCESS RESTRICTED|NOT FOUND|FORBIDDEN/);
    }
    expect((await ticketRow(bot, ticket.id)).status).toBe('open');
  });

  it('BREAK: staff cannot manage their own ticket', async () => {
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, staff.user);
    const { interaction } = await press(staff.user, id(ACTION.manage, ticket.id));
    expect(interaction.lastText()).toContain('cannot handle your own ticket');
  });

  it('BREAK: a handler sees only note and summary on a ticket assigned to someone else', async () => {
    const requester = await person(bot, ['verified']);
    const holder = await person(bot, ['moderator']);
    const other = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    await press(holder.user, id(ACTION.claim, ticket.id));
    const { interaction } = await press(other.user, id(ACTION.manage, ticket.id));
    expect(customIdsOf(interaction.lastPayload()!)).toEqual([
      id(ACTION.note, ticket.id),
      id(ACTION.summary, ticket.id),
    ]);
    const release = await press(other.user, id(ACTION.unclaim, ticket.id));
    expect(release.interaction.lastText()).not.toContain('RELEASED');
    expect((await ticketRow(bot, ticket.id)).assigneeUserId).toBe(holder.actor.userId);

    const lead = await person(bot, ['operations']);
    const managed = await press(lead.user, id(ACTION.manage, ticket.id));
    expect(customIdsOf(managed.interaction.lastPayload()!)).toContain(
      id(ACTION.transfer, ticket.id),
    );
  });

  it('BREAK: closed tickets, forged and unknown ids', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    const forged = await press(staff.user, 'tickets:manage:../../admin');
    expect(forged.interaction.lastText()).toContain('no longer valid');
    const unknown = await press(
      staff.user,
      id(ACTION.manage, '00000000-0000-4000-8000-000000000000'),
    );
    expect(unknown.interaction.lastText()).toContain('NOT FOUND');

    await bot.run({
      kind: 'modal',
      name: id(ACTION.close, ticket.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'Sorted.' },
    });
    const closed = await press(staff.user, id(ACTION.manage, ticket.id));
    expect(closed.interaction.lastText()).toContain('#0001 is closed. Reopen it first.');
  });
});
