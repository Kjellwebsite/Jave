import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs } from '@jave/database';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { BotHarness } from '../../testing/harness';
import { ACTION, FIELD, TICKETS_NS } from './constants';
import {
  HOOK_TIMEOUT,
  openViaDiscord,
  person,
  postedTo,
  SUITE,
  textOf,
  ticketBot,
  ticketRow,
} from './test-support';

/** A mention the bot did not neutralize (neutralized ones carry a zero-width space). */
const ZERO_WIDTH_SPACE = '\u200B';
const UNNEUTRALIZED_EVERYONE = new RegExp(`(^|[^${ZERO_WIDTH_SPACE}])@everyone`);
const UNNEUTRALIZED_HERE = new RegExp(`(^|[^${ZERO_WIDTH_SPACE}])@here`);

const MISSING_ACCESS = 50001;

describe('tickets — BREAK', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  it('BREAK: a requester pressing CLAIM is refused and the denial is audited', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const { interaction } = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: requester.user,
      channelId: ticket.threadId,
    });
    expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(interaction.lastPayload()!.ephemeral).toBe(true);
    expect((await ticketRow(bot, ticket.id)).assigneeUserId).toBeNull();
    const denials = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'access.denied'),
          eq(auditLogs.actorUserId, requester.actor.userId),
        ),
      );
    expect(denials.length).toBeGreaterThan(0);
  });

  it('BREAK: staff cannot claim, note or summarize their own ticket', async () => {
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, staff.user);
    const claim = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: staff.user,
    });
    expect(claim.interaction.lastText()).toContain('cannot handle your own ticket');
    const note = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.note, ticket.id),
      user: staff.user,
      modalText: { [FIELD.note]: 'note on my own case' },
    });
    expect(note.interaction.lastText()).toContain('cannot handle your own ticket');
  });

  it("BREAK: other members' tickets are invisible — buttons, commands, thread context", async () => {
    const owner = await person(bot, ['verified']);
    const stranger = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, owner.user);

    const close = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.close, ticket.id),
      user: stranger.user,
    });
    expect(close.interaction.lastText()).toContain('NOT FOUND');
    expect(close.interaction.responses.some((r) => r.type === 'modal')).toBe(false);

    const view = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'view',
      user: stranger.user,
      options: { ticket: ticket.id },
    });
    expect(view.interaction.lastText()).toContain('NOT FOUND');

    const forgedClose = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticket.id),
      user: stranger.user,
      modalText: { [FIELD.reason]: 'closing your ticket' },
    });
    expect(forgedClose.interaction.lastText()).toContain('NOT FOUND');
    expect((await ticketRow(bot, ticket.id)).status).toBe('open');

    // Inside someone else's thread the command cannot even tell it is a ticket.
    const inThread = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'close',
      user: stranger.user,
      channelId: ticket.threadId,
    });
    expect(inThread.interaction.lastText()).toContain('Use this inside a ticket thread');
  });

  it('BREAK: forged, stale and malformed custom ids and values', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);

    const notUuid = await bot.run({
      kind: 'button',
      name: 'tickets:claim:1 OR 1=1',
      user: staff.user,
    });
    expect(notUuid.interaction.lastText()).toContain('no longer valid');
    const unknownAction = await bot.run({
      kind: 'button',
      name: 'tickets:selfdestruct',
      user: staff.user,
    });
    expect(unknownAction.interaction.lastText()).toContain('EXPIRED');
    const unknownTicket = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, '00000000-0000-4000-8000-000000000000'),
      user: staff.user,
    });
    expect(unknownTicket.interaction.lastText()).toContain('NOT FOUND');

    const badCategory = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.category),
      user: requester.user,
      values: ['godmode'],
    });
    expect(badCategory.interaction.lastText()).toContain('INVALID INPUT');
    const badModal = await bot.run({
      kind: 'modal',
      name: 'tickets:open:godmode',
      user: requester.user,
      modalText: { [FIELD.subject]: 'x', [FIELD.body]: 'y' },
    });
    expect(badModal.interaction.lastText()).toContain('INVALID INPUT');
    const oversized = await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.open, 'general'),
      user: requester.user,
      modalText: { [FIELD.subject]: 's'.repeat(5000), [FIELD.body]: 'body text here' },
    });
    expect(oversized.interaction.lastText()).toContain('INVALID INPUT');

    const badPriority = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.priority, ticket.id),
      user: staff.user,
      values: ['apocalyptic'],
    });
    expect(badPriority.interaction.lastText()).toContain('INVALID INPUT');
    const badMember = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.transfer, ticket.id),
      user: staff.user,
      values: ['<@everyone>'],
    });
    expect(badMember.interaction.lastText()).toContain('INVALID INPUT');

    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.close, ticket.id),
      user: requester.user,
      modalText: { [FIELD.reason]: 'Solved.' },
    });
    const stale = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.claim, ticket.id),
      user: staff.user,
    });
    expect(stale.interaction.lastText()).toContain('#0001 is closed');
  });

  it('BREAK: transfer only to people who can handle tickets, never to the requester', async () => {
    const requester = await person(bot, ['verified']);
    const manager = await person(bot, ['operations']);
    const member = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const toMember = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.transfer, ticket.id),
      user: manager.user,
      values: [member.actor.discordId],
    });
    expect(toMember.interaction.lastText()).toContain('must be able to handle tickets');
    const toRequester = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'transfer',
      user: manager.user,
      options: { ticket: ticket.id, to: requester.user },
    });
    expect(toRequester.interaction.lastText()).toContain('cannot handle their own ticket');
    const unknown = await bot.run({
      kind: 'select',
      name: customId(TICKETS_NS, ACTION.transfer, ticket.id),
      user: manager.user,
      values: ['123456789012345678'],
    });
    expect(unknown.interaction.lastText()).toContain('no JAVE identity');
  });

  it('BREAK: members cannot open staff forms or post the panel', async () => {
    const requester = await person(bot, ['verified']);
    const moderator = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    for (const subcommand of ['note', 'waiting', 'priority', 'transfer', 'queue', 'summary']) {
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'ticket',
        subcommand,
        user: requester.user,
        channelId: ticket.threadId,
      });
      expect(interaction.lastText(), subcommand).toContain('ACCESS RESTRICTED');
      expect(interaction.responses.some((r) => r.type === 'modal')).toBe(false);
    }
    const panel = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'panel',
      user: moderator.user,
    });
    expect(panel.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(bot.gateway.callsTo('sendMessage').some((c) => c.args[0] === '100000000000000555')).toBe(
      false,
    );
  });

  it('BREAK: user text is escaped everywhere the bot renders it', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user, {
      subject: '@everyone **FREE ROLES** <@&123456789012345678>',
      body: '[click](https://evil.example) @here',
    });
    await bot.run({
      kind: 'modal',
      name: customId(TICKETS_NS, ACTION.waiting, ticket.id),
      user: staff.user,
      modalText: { [FIELD.reason]: 'Ping @everyone and <@123456789012345678> ~~now~~' },
    });
    const posted = postedTo(bot, ticket.threadId).map(textOf).join('\n');
    expect(posted).not.toMatch(UNNEUTRALIZED_EVERYONE);
    expect(posted).not.toMatch(UNNEUTRALIZED_HERE);
    expect(posted).not.toContain('<@123456789012345678>');
    expect(posted).not.toContain('<@&123456789012345678>');
    expect(posted).toContain('\\*\\*FREE ROLES\\*\\*');
    expect(posted).toContain('\\[click\\]\\(https://evil.example\\)');
  });

  it('BREAK: the panel reports a Discord permission error instead of failing silently', async () => {
    const manager = await person(bot, ['operations']);
    bot.gateway.failures.set(
      'sendMessage',
      new DiscordActionError('send message failed: Missing Access', MISSING_ACCESS, true),
    );
    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'panel',
      user: manager.user,
    });
    expect(interaction.lastText()).toContain('PANEL NOT POSTED');
    expect(interaction.lastText()).toContain('View Channel, Send Messages and Embed Links');
  });
});
