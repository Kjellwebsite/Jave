import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backoffMs } from '../jobs/queue';
import type { JobHandlerMap } from '../jobs/worker';
import type { TestKit } from '../testing';
import { claimTicket, setWaiting, transferTicket } from './assignment.service';
import { planCardUpdate } from './card-plan';
import {
  type CardChange,
  CLOSE_THREAD_JOB,
  OPEN_THREAD_JOB,
  parseTicketDiscordJobPayload,
  REOPEN_THREAD_JOB,
  UPDATE_CARD_JOB,
} from './discord-jobs';
import { closeTicket, reopenTicket } from './lifecycle.service';
import {
  createTicketKit,
  INTEGRATION_HOOK_TIMEOUT,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
  TICKET_CHANNEL_ID,
} from './test-fixtures';
import { getTicketCard, markThreadCreated } from './thread.service';
import { renderTranscript } from './transcript.service';

/**
 * MOCK / TEST ONLY — a stand-in for the bot's discord.tickets.* handlers that
 * follows each job contract against a recorded fake Discord, to prove the
 * contracts and callbacks compose end to end. `failOnce` makes the first
 * update_card job of those changes fail transiently (e.g. a 429), so it is
 * retried after the worker's backoff.
 */
function simulatedBot(kit: TestKit, options: { failOnce?: readonly CardChange[] } = {}) {
  const discord: string[] = [];
  const pendingFailures = new Set(options.failOnce ?? []);
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
      if (pendingFailures.delete(job.change)) throw new Error('429 Too Many Requests');
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      const plan = planCardUpdate(card, job);
      if (plan.editCard) discord.push(`editCard ${card.status} ${job.change}`);
      if (plan.addMemberDiscordId) discord.push(`addThreadMember ${plan.addMemberDiscordId}`);
      if (plan.announce?.kind === 'assigned') {
        discord.push(`post CLAIMED — ${plan.announce.assigneeName}`);
      }
      if (plan.announce?.kind === 'waiting') {
        discord.push(`post WAITING ON YOU — ${plan.announce.note}`);
      }
      return plan;
    },
    [CLOSE_THREAD_JOB]: async (ctx, payload) => {
      const job = parseTicketDiscordJobPayload(CLOSE_THREAD_JOB, payload);
      const card = await getTicketCard(ctx, { ticketId: job.ticketId });
      if (card.status !== 'closed' && card.status !== 'archived') return { skipped: true };
      discord.push(`post CLOSED ${job.threadId}`, `editCard ${card.status} close`);
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
  }, INTEGRATION_HOOK_TIMEOUT);
  afterEach(async () => {
    await kit.close();
  }, INTEGRATION_HOOK_TIMEOUT);

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
    expect(bot.discord).toContain(`addThreadMember ${mod.discordId}`);
    // The waiting job ran after the close: nothing reaches the closed thread.
    expect(bot.discord.some((l) => l.includes('Send the error text.'))).toBe(false);
    expect(bot.discord.some((l) => l.startsWith('editCard closed waiting'))).toBe(false);
    expect(bot.discord).toContain('editCard closed close');
    expect(bot.discord.some((l) => /^upload \d+ ticket-\d{4}\.html$/.test(l))).toBe(true);
    expect(bot.discord.some((l) => l.startsWith('lockAndArchive '))).toBe(true);
    expect(bot.discord.some((l) => l.endsWith('"Still failing."'))).toBe(true);
  });

  it('BREAK: a card update retried after the close never posts into the archived thread', async () => {
    const member = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    const bot = simulatedBot(kit, { failOnce: ['waiting'] });
    const ticket = await openAs(kit, member);
    await bot.drain();
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await bot.drain();
    expect(bot.discord).toContain(`post CLAIMED — ${mod.displayName}`);

    await setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Send the error text.' });
    await bot.drain(); // first attempt fails; the retry waits for the backoff
    await closeTicket(kit.as(mod), { ticketId: ticket.id, reason: 'No reply needed.' });
    await bot.drain(); // close_thread runs first: closing card, lock, archive
    expect(bot.discord.at(-1)).toMatch(/^lockAndArchive /);
    const afterClose = bot.discord.length;

    kit.clock.advance(backoffMs(1) + 1);
    const outcomes = await bot.drain();
    const retried = outcomes.find((o) => o.type === UPDATE_CARD_JOB);
    expect(retried?.status).toBe('completed');
    expect(retried?.result).toEqual({ editCard: false, addMemberDiscordId: null, announce: null });
    expect(bot.discord.length).toBe(afterClose);
  });

  it('BREAK: a stale claim job does not announce a handler who no longer holds the ticket', async () => {
    const member = await kit.member();
    const modA = await kit.member({ roles: ['moderator'] });
    const modB = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const bot = simulatedBot(kit);
    const ticket = await openAs(kit, member);
    await bot.drain();
    await claimTicket(kit.as(modA), { ticketId: ticket.id });
    await transferTicket(kit.as(ops), { ticketId: ticket.id, toUserId: modB.userId });
    await bot.drain();

    const announcements = bot.discord.filter((l) => l.startsWith('post CLAIMED'));
    expect(announcements).toEqual([`post CLAIMED — ${modB.displayName}`]);
    expect(bot.discord).not.toContain(`addThreadMember ${modA.discordId}`);
    expect(bot.discord).toContain(`addThreadMember ${modB.discordId}`);
  });
});

describe('tickets: planCardUpdate (pure)', () => {
  const ticketId = '00000000-0000-4000-8000-000000000001';
  const holder = {
    userId: '00000000-0000-4000-8000-00000000000a',
    discordId: '500000000000000001',
    displayName: 'Handler A',
  };
  const other = { ...holder, userId: '00000000-0000-4000-8000-00000000000b' };
  const threaded = {
    status: 'claimed' as const,
    threadId: '500000000000000010',
    cardMessageId: '500000000000000011',
    assignee: holder,
  };
  const job = (change: CardChange, extra: { note?: string; assigneeUserId?: string } = {}) => ({
    ticketId,
    change,
    note: extra.note ?? null,
    assigneeUserId: extra.assigneeUserId ?? null,
  });
  const nothing = { editCard: false, addMemberDiscordId: null, announce: null };
  const editOnly = { editCard: true, addMemberDiscordId: null, announce: null };

  it('does nothing before the thread and card exist', () => {
    expect(planCardUpdate({ ...threaded, threadId: null }, job('refresh'))).toEqual(nothing);
    expect(planCardUpdate({ ...threaded, cardMessageId: null }, job('refresh'))).toEqual(nothing);
  });

  it('does nothing at all once the ticket is closed or archived, whatever the change', () => {
    const changes: CardChange[] = [
      'claimed',
      'unclaimed',
      'transferred',
      'priority_changed',
      'waiting',
      'resumed',
      'refresh',
    ];
    for (const status of ['closed', 'archived'] as const) {
      for (const change of changes) {
        const payload = job(change, { note: 'Reply here.', assigneeUserId: holder.userId });
        expect(planCardUpdate({ ...threaded, status }, payload)).toEqual(nothing);
      }
    }
  });

  it('announces an assignment only for the assignee the job was enqueued for', () => {
    expect(planCardUpdate(threaded, job('claimed', { assigneeUserId: holder.userId }))).toEqual({
      editCard: true,
      addMemberDiscordId: holder.discordId,
      announce: { kind: 'assigned', assigneeName: 'Handler A' },
    });
    expect(
      planCardUpdate(
        { ...threaded, assignee: other },
        job('transferred', { assigneeUserId: holder.userId }),
      ),
    ).toEqual(editOnly);
    expect(
      planCardUpdate(
        { ...threaded, status: 'open', assignee: null },
        job('claimed', { assigneeUserId: holder.userId }),
      ),
    ).toEqual(editOnly);
  });

  it('announces a waiting reason only while the ticket is still waiting', () => {
    const waiting = job('waiting', { note: 'Which account?' });
    expect(planCardUpdate({ ...threaded, status: 'waiting' }, waiting)).toEqual({
      ...editOnly,
      announce: { kind: 'waiting', note: 'Which account?' },
    });
    expect(planCardUpdate(threaded, waiting)).toEqual(editOnly);
    expect(planCardUpdate({ ...threaded, status: 'waiting' }, job('waiting'))).toEqual(editOnly);
  });

  it('refresh adds the current assignee; other changes only edit the card', () => {
    expect(planCardUpdate(threaded, job('refresh'))).toEqual({
      ...editOnly,
      addMemberDiscordId: holder.discordId,
    });
    expect(planCardUpdate({ ...threaded, assignee: null }, job('refresh'))).toEqual(editOnly);
    for (const change of ['unclaimed', 'priority_changed', 'resumed'] as const) {
      expect(planCardUpdate(threaded, job(change))).toEqual(editOnly);
    }
  });
});
