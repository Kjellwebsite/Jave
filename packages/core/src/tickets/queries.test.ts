import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tickets } from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';
import type { TestKit } from '../testing';
import { claimTicket } from './assignment.service';
import { closeTicket } from './lifecycle.service';
import { listTickets } from './queries.service';
import { runSlaSweep } from './sweeps';
import {
  botContext,
  createTicketKit,
  INTEGRATION_HOOK_TIMEOUT,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
  provisionThread,
  TICKET_CHANNEL_ID,
} from './test-fixtures';
import { getTicketCard, getTicketIdForThread } from './thread.service';

describe('tickets: queries', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  }, INTEGRATION_HOOK_TIMEOUT);
  afterEach(async () => {
    await kit.close();
  }, INTEGRATION_HOOK_TIMEOUT);

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
