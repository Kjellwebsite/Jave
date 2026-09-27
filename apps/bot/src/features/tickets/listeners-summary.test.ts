import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DisabledProvider, MockProvider } from '@jave/ai';
import { ticketMessages } from '@jave/database';
import { tickets } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { BotHarness } from '../../testing/harness';
import { ACTION, TICKETS_NS } from './constants';
import {
  HOOK_TIMEOUT,
  openViaDiscord,
  person,
  SUITE,
  threadMessage,
  ticketBot,
} from './test-support';

/** A mention the bot did not neutralize (neutralized ones carry a zero-width space). */
const ZERO_WIDTH_SPACE = '\u200B';
const UNNEUTRALIZED_EVERYONE = new RegExp(`(^|[^${ZERO_WIDTH_SPACE}])@everyone`);

describe('tickets — gateway listeners', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  async function recorded(ticketId: string) {
    return bot.kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(ticketMessages.seq);
  }

  it('records thread messages with attachments, edits and deletions', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const message = threadMessage(ticket.threadId, requester.user, 'Here is the log.', {
      attachments: [
        {
          name: 'build.log',
          url: 'https://cdn.discordapp.com/attachments/1/2/build.log',
          size: 2048,
          contentType: 'text/plain; charset=utf-8',
        },
        {
          name: 'x'.repeat(400),
          url: 'https://cdn.discordapp.com/attachments/1/2/y.bin',
          size: 1,
          contentType: 'not a mime type',
        },
      ],
    });
    await bot.app.events.message(message);
    await bot.app.events.messageUpdate({
      id: message.id,
      channelId: ticket.threadId,
      guildId: message.guildId,
      content: 'Here is the full log.',
      editedAt: new Date('2026-03-01T12:06:00.000Z'),
    });
    const rows = await recorded(ticket.id);
    const reply = rows.find((row) => row.discordMessageId === message.id)!;
    expect(reply.body).toBe('Here is the full log.');
    expect(reply.originalBody).toBe('Here is the log.');
    expect(reply.attachments).toHaveLength(2);
    expect(reply.attachments[1]!.contentType).toBeUndefined();

    await bot.app.events.messageDelete({
      id: message.id,
      channelId: ticket.threadId,
      guildId: message.guildId,
    });
    const [deleted] = (await recorded(ticket.id)).filter(
      (row) => row.discordMessageId === message.id,
    );
    expect(deleted!.deletedAt).not.toBeNull();
  });

  it('ignores bots, non-thread channels, other guilds, empty messages and non-ticket threads', async () => {
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const before = (await recorded(ticket.id)).length;
    await bot.app.events.message(
      threadMessage(ticket.threadId, { ...requester.user, bot: true }, 'I am a bot'),
    );
    await bot.app.events.message(
      threadMessage(ticket.threadId, requester.user, 'not in a thread', { isThread: false }),
    );
    await bot.app.events.message(
      threadMessage(ticket.threadId, requester.user, 'other guild', {
        guildId: '999999999999999999',
      }),
    );
    await bot.app.events.message(threadMessage(ticket.threadId, requester.user, '   '));
    await bot.app.events.message(threadMessage('500000000000000001', requester.user, 'elsewhere'));
    expect(await recorded(ticket.id)).toHaveLength(before);
  });

  it('a staff reply in the thread stamps the first response', async () => {
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    await bot.app.events.message(threadMessage(ticket.threadId, staff.user, 'Looking into it.'));
    const view = await tickets.getTicket(bot.kit.as(staff.actor), { ticketId: ticket.id });
    expect(view.sla?.state).toBe('met');
  });
});

describe('tickets — AI summary', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await ticketBot();
  }, HOOK_TIMEOUT);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT);

  it('reports DISABLED when no AI provider is configured — and sends nothing', async () => {
    bot.app.services.ai = { provider: new DisabledProvider() };
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user);
    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'summary',
      user: staff.user,
      channelId: ticket.threadId,
    });
    expect(interaction.lastText()).toContain('SUMMARY #0001 · DISABLED');
    expect(interaction.lastPayload()!.ephemeral).toBe(true);
  });

  it('generates an AI-GENERATED staff-only summary, reuses it, and regenerates on request', async () => {
    const provider = new MockProvider({
      respond: () =>
        '- Requester reports a failing deploy.\n- Next: check runner memory. @everyone',
    });
    bot.app.services.ai = { provider };
    const requester = await person(bot, ['verified']);
    const staff = await person(bot, ['moderator']);
    const ticket = await openViaDiscord(bot, requester.user, {
      body: 'Deploy fails. My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 if needed.',
    });
    const first = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'summary',
      user: staff.user,
      options: { ticket: ticket.id },
    });
    expect(first.interaction.responses[0]).toEqual({ type: 'defer', ephemeral: true });
    const text = first.interaction.lastText();
    expect(text).toContain('AI-GENERATED · STAFF ONLY');
    expect(text).toContain('Requester reports a failing deploy.');
    expect(text).not.toMatch(UNNEUTRALIZED_EVERYONE);
    expect(provider.calls).toHaveLength(1);
    const prompt = provider.calls[0]!.request.messages.map((m) => m.content).join('\n');
    expect(prompt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(prompt).toContain('#0001');

    const again = await bot.run({
      kind: 'slash',
      name: 'ticket',
      subcommand: 'summary',
      user: staff.user,
      options: { ticket: ticket.id },
    });
    expect(again.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('Stored summary');
    expect(provider.calls).toHaveLength(1);

    const regenerated = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.summary, ticket.id, 'force'),
      user: staff.user,
    });
    expect(regenerated.interaction.lastPayload()!.embeds![0]!.footer!.text).toMatch(/^Generated/);
    expect(provider.calls).toHaveLength(2);
  });

  it('BREAK: requesters never get a summary, even with AI configured', async () => {
    bot.app.services.ai = { provider: new MockProvider() };
    const requester = await person(bot, ['verified']);
    const ticket = await openViaDiscord(bot, requester.user);
    const forged = await bot.run({
      kind: 'button',
      name: customId(TICKETS_NS, ACTION.summary, ticket.id, 'force'),
      user: requester.user,
    });
    expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
  });
});
