import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members, ticketMessages } from '@jave/database';
import { HOUR } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import {
  claimTicket,
  setPriority,
  setWaiting,
  transferTicket,
  unclaimTicket,
} from './assignment.service';
import { closeTicket, openTicket, reopenTicket } from './lifecycle.service';
import { addInternalNote, recordMessage, recordMessageDelete } from './messages.service';
import { getTicket, getTicketStats, listTickets } from './queries.service';
import {
  auditOf,
  authorOf,
  createTicketKit,
  INTEGRATION_SUITE,
  nextSnowflake,
  openAs,
  provisionThread,
} from './test-fixtures';
import {
  getTicketCard,
  getTicketIdForThread,
  markThreadCreated,
  markThreadMissing,
} from './thread.service';

describe('tickets: access control (BREAK)', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  });
  afterEach(async () => {
    await kit.close();
  });

  async function scene() {
    const opener = await kit.member({ roles: ['verified'] });
    const other = await kit.member({ roles: ['verified'] });
    const mod = await kit.member({ roles: ['moderator'] });
    const modB = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const ticket = await openAs(kit, opener);
    await addInternalNote(kit.as(mod), {
      ticketId: ticket.id,
      body: 'INTERNAL: possible alt account.',
    });
    return { opener, other, mod, modB, ops, ticket };
  }

  it('BREAK: opener never sees internal notes or staff-only events via getTicket', async () => {
    const { opener, mod, ticket } = await scene();
    await setPriority(kit.as(mod), { ticketId: ticket.id, priority: 'high' });
    const view = await getTicket(kit.as(opener), { ticketId: ticket.id });
    expect(view.viewer).toBe('requester');
    expect(view.messages.every((m) => !m.isInternal)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('INTERNAL: possible alt account.');
    expect(view.events.map((e) => e.type)).toEqual(['created']);
    expect(view.sla).toBeNull();
    expect(view.aiSummary).toBeNull();

    const staff = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(staff.viewer).toBe('handler');
    expect(staff.messages.some((m) => m.isInternal)).toBe(true);
    expect(staff.events.map((e) => e.type)).toEqual(['created', 'note_added', 'priority_changed']);
    expect(staff.sla?.state).toBe('pending');
  });

  it("BREAK: a member cannot read, list, card or locate someone else's ticket (IDOR)", async () => {
    const { other, ticket } = await scene();
    await expect(getTicket(kit.as(other), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(getTicketCard(kit.as(other), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const page = await listTickets(kit.as(other), {});
    expect(page.items).toHaveLength(0);
    const filtered = await listTickets(kit.as(other), {
      openerUserId: ticket.id,
      assignee: 'none',
    });
    expect(filtered.items).toHaveLength(0);
    const threadId = await provisionThread(kit, ticket.id);
    expect(await getTicketIdForThread(kit.as(other), { threadId })).toBeNull();
    // Denials are audited, and indistinguishable from a missing ticket.
    expect((await auditOf(kit, 'access.denied', ticket.id)).length).toBeGreaterThanOrEqual(2);
    await expect(
      getTicket(kit.as(other), { ticketId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toThrow('Ticket not found.');
  });

  it('BREAK: anonymous callers are rejected outright', async () => {
    const { ticket } = await scene();
    await expect(getTicket(kit.as(anonymousActor), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(listTickets(kit.as(anonymousActor), {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      openTicket(kit.as(anonymousActor), {
        category: 'general',
        subject: 'Hello',
        body: 'Hi there',
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('BREAK: non-handlers cannot claim, note, prioritise, wait or transfer', async () => {
    const { other, opener, ticket } = await scene();
    for (const actor of [other, opener]) {
      const ctx = kit.as(actor);
      await expect(claimTicket(ctx, { ticketId: ticket.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        addInternalNote(ctx, { ticketId: ticket.id, body: 'sneaky' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setPriority(ctx, { ticketId: ticket.id, priority: 'urgent' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        setWaiting(ctx, { ticketId: ticket.id, reason: 'Stop the clock' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        transferTicket(ctx, { ticketId: ticket.id, toUserId: actor.userId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      closeTicket(kit.as(other), { ticketId: ticket.id, reason: 'Closing yours' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('BREAK: staff cannot handle their own ticket (self-claim, self-note, self-priority)', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const own = await openAs(kit, ops);
    await expect(claimTicket(kit.as(ops), { ticketId: own.id })).rejects.toThrow(
      'You cannot handle your own ticket.',
    );
    await expect(
      addInternalNote(kit.as(ops), { ticketId: own.id, body: 'note to self' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setPriority(kit.as(ops), { ticketId: own.id, priority: 'urgent' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await claimTicket(kit.as(mod), { ticketId: own.id });
    await expect(
      transferTicket(kit.as(mod), { ticketId: own.id, toUserId: ops.userId }),
    ).rejects.toBeInstanceOf(ValidationError);
    const denied = await auditOf(kit, 'access.denied', own.id);
    expect(denied.map((d) => (d.context as { rule?: string }).rule)).toContain('own_ticket');
  });

  it('BREAK: concurrent claims by two handlers produce exactly one assignee', async () => {
    const { mod, modB, ticket } = await scene();
    const results = await Promise.allSettled([
      claimTicket(kit.as(mod), { ticketId: ticket.id }),
      claimTicket(kit.as(modB), { ticketId: ticket.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ConflictError);
    expect(await auditOf(kit, 'ticket.claimed', ticket.id)).toHaveLength(1);
  });

  it('BREAK: transfer to a non-handler, unknown user or current assignee is rejected', async () => {
    const { other, mod, modB, ops, ticket } = await scene();
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    await expect(
      transferTicket(kit.as(mod), { ticketId: ticket.id, toUserId: other.userId }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transferTicket(kit.as(mod), {
        ticketId: ticket.id,
        toUserId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      transferTicket(kit.as(ops), { ticketId: ticket.id, toUserId: mod.userId }),
    ).rejects.toBeInstanceOf(ConflictError);
    // A quarantined moderator has lost canHandleTickets.
    await kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, modB.memberId!));
    await expect(
      transferTicket(kit.as(mod), { ticketId: ticket.id, toUserId: modB.userId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("BREAK: a handler cannot act on or steal another handler's ticket", async () => {
    const { opener, mod, modB, ticket } = await scene();
    await claimTicket(kit.as(mod), { ticketId: ticket.id });
    const asB = kit.as(modB);
    await expect(
      transferTicket(asB, { ticketId: ticket.id, toUserId: modB.userId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(unclaimTicket(asB, { ticketId: ticket.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      closeTicket(asB, { ticketId: ticket.id, reason: 'Not mine but closing' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setWaiting(asB, { ticketId: ticket.id, reason: 'Pausing it' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // …but may still read it and leave an internal note.
    await expect(getTicket(asB, { ticketId: ticket.id })).resolves.toMatchObject({
      viewer: 'handler',
    });
    await addInternalNote(asB, { ticketId: ticket.id, body: 'Seen this before.' });
    // The opener can always close their own ticket.
    await expect(
      closeTicket(kit.as(opener), { ticketId: ticket.id, reason: 'All good now.' }),
    ).resolves.toMatchObject({ status: 'closed' });
  });

  it('BREAK: only the bot (system) may call thread and message callbacks', async () => {
    const { opener, ops, ticket } = await scene();
    const threadId = nextSnowflake();
    for (const actor of [opener, ops]) {
      const ctx = kit.as(actor);
      await expect(
        markThreadCreated(ctx, { ticketId: ticket.id, threadId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        markThreadMissing(ctx, { ticketId: ticket.id, threadId }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordMessage(ctx, {
          threadId,
          discordMessageId: nextSnowflake(),
          author: authorOf(opener),
          body: 'Forged message',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        recordMessageDelete(ctx, { discordMessageId: nextSnowflake() }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const denials = await auditOf(kit, 'access.denied');
    expect(
      denials.filter((d) => (d.context as { rule?: string }).rule === 'system_only'),
    ).toHaveLength(8);
    const forged = await kit.db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.body, 'Forged message'));
    expect(forged).toHaveLength(0);
  });

  it('BREAK: invalid transitions are refused', async () => {
    const { opener, mod, ticket } = await scene();
    await expect(
      reopenTicket(kit.as(opener), { ticketId: ticket.id, reason: 'Reopen an open one' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(unclaimTicket(kit.as(mod), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await closeTicket(kit.as(opener), { ticketId: ticket.id, reason: 'Done now.' });
    await expect(
      closeTicket(kit.as(opener), { ticketId: ticket.id, reason: 'Close twice' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(claimTicket(kit.as(mod), { ticketId: ticket.id })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
    await expect(
      setPriority(kit.as(mod), { ticketId: ticket.id, priority: 'low' }),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('BREAK: reopening respects maxOpenPerUser for the requester only', async () => {
    const opener = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    await updateSettings(kit.system, 'tickets', { maxOpenPerUser: 1 });
    const first = await openAs(kit, opener);
    await closeTicket(kit.as(opener), { ticketId: first.id, reason: 'Closing first.' });
    await openAs(kit, opener);
    await expect(
      reopenTicket(kit.as(opener), { ticketId: first.id, reason: 'Back again' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      reopenTicket(kit.as(mod), { ticketId: first.id, reason: 'Staff reopening' }),
    ).resolves.toMatchObject({ status: 'open' });
  });

  it('BREAK: open rate limit stops open/close churn', async () => {
    const opener = await kit.member();
    await updateSettings(kit.system, 'tickets', { openRatePerHour: 2 });
    for (let i = 0; i < 2; i++) {
      const t = await openAs(kit, opener);
      await closeTicket(kit.as(opener), { ticketId: t.id, reason: 'Churning tickets.' });
    }
    await expect(openAs(kit, opener)).rejects.toBeInstanceOf(RateLimitedError);
    kit.clock.advance(HOUR + 1);
    await expect(openAs(kit, opener)).resolves.toMatchObject({ status: 'open' });
  });

  it('BREAK: quarantined and banned members cannot open tickets', async () => {
    const opener = await kit.member();
    for (const standing of ['quarantined', 'banned'] as const) {
      await kit.db.update(members).set({ standing }).where(eq(members.id, opener.memberId!));
      const { resolveUserActor } = await import('../identity/users.service');
      const actor = await resolveUserActor(kit.system, opener.userId);
      await expect(openAs(kit, actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('BREAK: huge, malformed and injection-shaped input is rejected before any write', async () => {
    const opener = await kit.member();
    const ctx = kit.as(opener);
    await expect(
      openTicket(ctx, { category: 'general', subject: 'A'.repeat(121), body: 'fine body' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      openTicket(ctx, { category: 'general', subject: 'Big body', body: 'B'.repeat(4001) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      openTicket(ctx, { category: 'general', subject: 'Huge', body: 'C'.repeat(10_000_000) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(getTicket(ctx, { ticketId: "' OR 1=1 --" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(listTickets(ctx, { limit: 10_000 })).rejects.toBeInstanceOf(ValidationError);
    // SQL-looking and NUL-laden text is stored inertly (parameterized, cleaned).
    const t = await openTicket(ctx, {
      category: 'general',
      subject: "Robert'); DROP TABLE tickets;--",
      body: 'Body with NUL \u0000 byte',
    });
    const view = await getTicket(ctx, { ticketId: t.id });
    expect(view.subject).toBe("Robert'); DROP TABLE tickets;--");
    expect(view.messages[0]!.body).toBe('Body with NUL  byte');
  });

  it('BREAK: LIKE wildcards in search are literal', async () => {
    const opener = await kit.member();
    const mod = await kit.member({ roles: ['moderator'] });
    await openAs(kit, opener, { subject: 'Plain subject line' });
    const page = await listTickets(kit.as(mod), { search: '%' });
    expect(page.items).toHaveLength(0);
    const hit = await listTickets(kit.as(mod), { search: 'subject' });
    expect(hit.items).toHaveLength(1);
  });

  it('BREAK: ticket stats need analytics or ticket management', async () => {
    const { other, mod, ops } = await scene();
    await expect(getTicketStats(kit.as(other))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTicketStats(kit.as(mod))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTicketStats(kit.as(ops))).resolves.toMatchObject({ opened: 1 });
    await expect(
      getTicketStats(kit.as(ops), { since: '2026-03-02', until: '2026-03-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
