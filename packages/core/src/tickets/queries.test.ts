import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tickets } from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';
import type { JobHandlerMap } from '../jobs/worker';
import type { TestKit } from '../testing';
import { claimTicket, setWaiting } from './assignment.service';
import {
  CLOSE_THREAD_JOB,
  OPEN_THREAD_JOB,
  parseTicketDiscordJobPayload,
  REOPEN_THREAD_JOB,
  UPDATE_CARD_JOB,
} from './discord-jobs';
import { closeTicket, reopenTicket } from './lifecycle.service';
import { listTickets } from './queries.service';
import { runSlaSweep } from './sweeps';
import {
  botContext,
  createTicketKit,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
  provisionThread,
  TICKET_CHANNEL_ID,
} from './test-fixtures';
import { getTicketCard, getTicketIdForThread, markThreadCreated } from './thread.service';
import { renderTranscript } from './transcript.service';

describe('tickets: queries', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('lists with handler filters, pagination and sorting', async () => {
    const a = await kit.member();
    const b = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const t1 = await openAs(kit, a, {
      priority: 'urgent',
      category: 'report',
      subject: 'Spam raid',
    });
    kit.clock.advance(MINUTE);
    const t2 = await openAs(kit, b, { priority: 'low', subject: 'Profile question' });
    kit.clock.advance(MINUTE);
    const t3 = await openAs(kit, a, { priority: 'normal', subject: 'Trial scheduling' });
    await claimTicket(kit.as(mod), { ticketId: t3.id });
    kit.clock.advance(2 * HOUR);
    await runSlaSweep(botContext(kit));

    const all = await listTickets(kit.as(mod), {});
    expect(all.total).toBe(3);
    expect(all.items.map((t) => t.id)).toEqual([t3.id, t2.id, t1.id]);
    expect(all.items[0]!.sla).not.toBeNull();

    const oldest = await listTickets(kit.as(mod), { sort: 'oldest', limit: 2 });
    expect(oldest.items.map((t) => t.id)).toEqual([t1.id, t2.id]);
    const page2 = await listTickets(kit.as(mod), { sort: 'oldest', limit: 2, offset: 2 });
    expect(page2.items.map((t) => t.id)).toEqual([t3.id]);
    expect(page2.total).toBe(3);

    const bySla = await listTickets(kit.as(mod), { sort: 'sla' });
    expect(bySla.items[0]!.id).toBe(t1.id);

    expect((await listTickets(kit.as(mod), { assignee: 'me' })).items.map((t) => t.id)).toEqual([
      t3.id,
    ]);
    expect((await listTickets(kit.as(mod), { assignee: 'none' })).total).toBe(2);
    expect((await listTickets(kit.as(mod), { breached: true })).items.map((t) => t.id)).toEqual([
      t1.id,
    ]);
    expect((await listTickets(kit.as(mod), { category: 'report' })).total).toBe(1);
    expect((await listTickets(kit.as(mod), { priority: 'low' })).total).toBe(1);
    expect((await listTickets(kit.as(mod), { openerUserId: a.userId })).total).toBe(2);
    expect((await listTickets(kit.as(mod), { search: 'trial' })).total).toBe(1);
    expect((await listTickets(kit.as(mod), { mine: true })).total).toBe(0);
  });

  it('requesters list only their own tickets without staff fields; archived only on request', async () => {
    const a = await kit.member();
    const b = await kit.member();
    const mine = await openAs(kit, a);
    await openAs(kit, b);
    const page = await listTickets(kit.as(a), { assignee: 'none', breached: false });
    expect(page.items.map((t) => t.id)).toEqual([mine.id]);
    expect(page.items[0]!.sla).toBeNull();

    await closeTicket(kit.as(a), { ticketId: mine.id, reason: 'Resolved it.' });
    await kit.db.update(tickets).set({ status: 'archived' }).where(eq(tickets.id, mine.id));
    expect((await listTickets(kit.as(a), {})).total).toBe(0);
    expect((await listTickets(kit.as(a), { status: ['archived'] })).total).toBe(1);
  });

  it('builds a requester-safe card and resolves threads for allowed viewers', async () => {
    const member = await kit.member({ username: 'card_owner' });
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, member, { body: 'x'.repeat(3000) });
    const threadId = await provisionThread(kit, ticket.id);
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    const card = await getTicketCard(botContext(kit), { ticketId: ticket.id });
    expect(card).toMatchObject({
      reference: ticket.reference,
      status: 'claimed',
      threadId,
      parentChannelId: TICKET_CHANNEL_ID,
      opener: { userId: member.userId, discordId: member.discordId },
      assignee: { userId: mod.userId },
    });
    expect(card.openingMessage!.length).toBeLessThanOrEqual(1000);
    expect(Object.keys(card)).not.toContain('aiSummary');
    expect(Object.keys(card)).not.toContain('sla');
    expect(await getTicketIdForThread(kit.as(member), { threadId })).toBe(ticket.id);
    expect(await getTicketIdForThread(kit.as(mod), { threadId })).toBe(ticket.id);
    expect(await getTicketIdForThread(kit.as(mod), { threadId: nextSnowflake() })).toBeNull();
  });
});

/**
 * MOCK / TEST ONLY — a stand-in for the bot's discord.tickets.* handlers that
 * follows each job contract against a recorded fake Discord, to prove the
 * contracts and callbacks compose end to end.
 */
function simulatedBot(kit: TestKit) {
  const discord: string[] = [];
  const handlers: JobHandlerMap = {
    [OPEN_THREAD_JOB]: async (ctx, payload) => {
      const job = parseTicketDiscordJobPayload(OPEN_THREAD_JOB, payload);
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      if (card.threadId || card.status === 'archived') return { skipped: true };
      const threadId = nextSnowflake();
      discord.push(`createPrivateThread ${job.parentChannelId} "${job.threadName}"`);
      discord.push(`addThreadMember ${job.openerDiscordId}`);
      await markThreadCreated(ctx, {
        ticketId: job.ticketId,
        threadId,
        cardMessageId: nextSnowflake(),
      });
      return { threadId };
    },
    [UPDATE_CARD_JOB]: async (ctx, payload) => {
      const job = parseTicketDiscordJobPayload(UPDATE_CARD_JOB, payload);
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      discord.push(`editCard ${card.status} ${job.change}${job.note ? ` "${job.note}"` : ''}`);
    },
    [CLOSE_THREAD_JOB]: async (ctx, payload) => {
      const job = parseTicketDiscordJobPayload(CLOSE_THREAD_JOB, payload);
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      if (card.status !== 'closed' && card.status !== 'archived') return { skipped: true };
      if (job.archiveChannelId) {
        const transcript = await renderTranscript(ctx, { ticketId: job.ticketId, format: 'html' });
        discord.push(`upload ${job.archiveChannelId} ${transcript.filename}`);
      }
      discord.push(`lockAndArchive ${job.threadId}`);
    },
    [REOPEN_THREAD_JOB]: async (ctx, payload) => {
      const job = parseTicketDiscordJobPayload(REOPEN_THREAD_JOB, payload);
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      if (card.status === 'closed' || card.status === 'archived') return { skipped: true };
      discord.push(`unarchive ${job.threadId} "${job.reason}"`);
    },
  };
  return { discord, drain: () => kit.drain(handlers) };
}

describe('tickets: Discord job contracts (simulated bot)', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  it('drives a ticket end to end through every contract and callback', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const bot = simulatedBot(kit);
    const ticket = await openAs(kit, member);
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await bot.drain();
    await setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Send the error text.' });
    await closeTicket(kit.as(mod), { ticketId: ticket.id, reason: 'Answered in thread.' });
    await bot.drain();
    await reopenTicket(kit.as(member), { ticketId: ticket.id, reason: 'Still failing.' });
    await bot.drain();

    expect(bot.discord[0]).toMatch(
      new RegExp(`^createPrivateThread ${TICKET_CHANNEL_ID} "#\\d{4} · `),
    );
    expect(bot.discord).toContain(`addThreadMember ${member.discordId}`);
    // Claimed before the thread existed: the refresh after creation renders it.
    expect(bot.discord).toContain('editCard claimed refresh');
    expect(bot.discord).toContain('editCard closed waiting "Send the error text."');
    expect(bot.discord.some((l) => /^upload \d+ ticket-\d{4}\.html$/.test(l))).toBe(true);
    expect(bot.discord.some((l) => l.startsWith('lockAndArchive '))).toBe(true);
    expect(bot.discord.some((l) => l.endsWith('"Still failing."'))).toBe(true);
  });
});
