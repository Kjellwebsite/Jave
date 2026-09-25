import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { domainEvents, ticketEvents, tickets } from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';
import type { UserActor } from '../permissions/actor';
import type { TestKit } from '../testing';
import { setWaiting } from './assignment.service';
import { closeTicket, reopenTicket } from './lifecycle.service';
import { recordMessage } from './messages.service';
import { getTicket, getTicketStats, listTickets } from './queries.service';
import { provenBreach } from './sla';
import { slaBreachPatch } from './sla-outcome';
import { runSlaSweep } from './sweeps';
import {
  authorOf,
  botContext,
  createTicketKit,
  INTEGRATION_HOOK_TIMEOUT,
  INTEGRATION_SUITE,
  nextSnowflake,
  notificationsFor,
  openAs,
  provisionThread,
  ticketEventTypes,
} from './test-fixtures';
import { renderTranscript } from './transcript.service';

/** Default settings: an urgent ticket's first response is due 60 minutes after opening. */
const URGENT_SLA_MINUTES = 60;

describe('tickets: SLA outcome (pure)', () => {
  const opened = new Date('2026-03-01T12:00:00.000Z');
  const due = new Date(opened.getTime() + HOUR);
  const at = (minutes: number) => new Date(opened.getTime() + minutes * MINUTE);
  const base = {
    slaFirstResponseDueAt: due,
    firstResponseAt: null,
    slaBreachedAt: null,
    closedAt: null,
  };

  it('is undecided while unanswered and open', () => {
    expect(provenBreach(base)).toBeUndefined();
  });

  it('decides on the first response: on the deadline is met, after it is breached', () => {
    expect(provenBreach({ ...base, firstResponseAt: due })).toBeNull();
    expect(provenBreach({ ...base, firstResponseAt: new Date(due.getTime() + 1) })).toEqual(due);
  });

  it('decides an unanswered close the same way', () => {
    expect(provenBreach({ ...base, closedAt: at(59) })).toBeNull();
    expect(provenBreach({ ...base, closedAt: at(62) })).toEqual(due);
  });

  it('the first response wins over the close time', () => {
    expect(provenBreach({ ...base, firstResponseAt: at(30), closedAt: at(90) })).toBeNull();
  });

  it('a ticket without a target is never breached', () => {
    expect(provenBreach({ ...base, slaFirstResponseDueAt: null, firstResponseAt: at(999) })).toBe(
      null,
    );
  });

  it('patches only what differs from the stored outcome', () => {
    expect(slaBreachPatch(base)).toEqual({});
    expect(slaBreachPatch({ ...base, firstResponseAt: at(63) })).toEqual({ slaBreachedAt: due });
    expect(slaBreachPatch({ ...base, firstResponseAt: at(63), slaBreachedAt: due })).toEqual({});
    expect(slaBreachPatch({ ...base, firstResponseAt: at(50), slaBreachedAt: due })).toEqual({
      slaBreachedAt: null,
    });
    // A sweep-recorded breach of a still-unanswered ticket is left alone.
    expect(slaBreachPatch({ ...base, slaBreachedAt: due })).toEqual({});
  });
});

describe(
  'tickets: SLA outcome is independent of sweep and delivery timing',
  INTEGRATION_SUITE,
  () => {
    let kit: TestKit;
    let mod: UserActor;
    let ops: UserActor;
    let member: UserActor;
    beforeEach(async () => {
      kit = await createTicketKit();
      mod = await kit.member({ roles: ['moderator'] });
      ops = await kit.member({ roles: ['operations'] });
      member = await kit.member();
    }, INTEGRATION_HOOK_TIMEOUT);
    afterEach(async () => {
      await kit.close();
    }, INTEGRATION_HOOK_TIMEOUT);

    async function reply(threadId: string, author: UserActor, sentAt?: Date) {
      return recordMessage(botContext(kit), {
        threadId,
        discordMessageId: nextSnowflake(),
        author: authorOf(author),
        body: 'Looking into it now.',
        ...(sentAt && { sentAt }),
      });
    }

    async function row(ticketId: string) {
      const [ticket] = await kit.db.select().from(tickets).where(eq(tickets.id, ticketId));
      return ticket!;
    }

    async function domainEventsOf(type: string, ticketId: string) {
      return kit.db
        .select()
        .from(domainEvents)
        .where(and(eq(domainEvents.type, type), eq(domainEvents.aggregateId, ticketId)));
    }

    async function breachEventData(ticketId: string) {
      const rows = await kit.db
        .select({ data: ticketEvents.data })
        .from(ticketEvents)
        .where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.type, 'sla_breached')));
      return rows.map((r) => r.data);
    }

    const missedAlerts = async (userId: string) =>
      (await notificationsFor(kit, userId)).filter((n) =>
        n.title.endsWith('RESPONSE TARGET MISSED'),
      );

    it('BREAK: a late reply that beats the sweep is still a breach', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      kit.clock.advance((URGENT_SLA_MINUTES + 3) * MINUTE);
      const result = await reply(threadId, mod);
      expect(result.firstResponse).toBe(true);

      const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
      expect(view.sla).toMatchObject({ state: 'breached', firstResponseMinutes: 63 });
      expect(view.sla!.breachedAt).toEqual(view.sla!.dueAt);

      kit.clock.advance(2 * MINUTE);
      expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
      expect(await breachEventData(ticket.id)).toEqual([
        expect.objectContaining({ decidedBy: 'response' }),
      ]);
      const [event] = await domainEventsOf('ticket.sla_breached', ticket.id);
      expect(event!.payload).toMatchObject({ decidedBy: 'response' });
      expect(event!.subjectMemberId).toBe(member.memberId);
      // Already answered: nobody is paged about a target that is past acting on.
      expect(await missedAlerts(mod.userId)).toHaveLength(0);

      const breached = await listTickets(kit.as(mod), { breached: true });
      expect(breached.items.map((t) => t.id)).toEqual([ticket.id]);
      const stats = await getTicketStats(kit.as(ops));
      expect(stats.sla).toEqual({ decided: 1, breached: 1, breachRate: 1 });
    });

    it('BREAK: setWaiting after the deadline, before the sweep, is a breach', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      kit.clock.advance((URGENT_SLA_MINUTES + 1) * MINUTE);
      const waiting = await setWaiting(kit.as(mod), {
        ticketId: ticket.id,
        reason: 'Which build?',
      });
      expect(waiting.sla?.state).toBe('breached');
      kit.clock.advance(5 * MINUTE);
      expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
      expect(await ticketEventTypes(kit, ticket.id)).toContain('sla_breached');
    });

    it('BREAK: closing an unanswered ticket after the deadline, before the sweep, is a breach', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      kit.clock.advance((URGENT_SLA_MINUTES + 2) * MINUTE);
      await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Gave up waiting.' });
      const closed = await row(ticket.id);
      expect(closed.slaBreachedAt).toEqual(closed.slaFirstResponseDueAt);
      expect(await breachEventData(ticket.id)).toEqual([
        expect.objectContaining({ decidedBy: 'close' }),
      ]);
      expect(await domainEventsOf('ticket.sla_breached', ticket.id)).toHaveLength(1);

      // Reopening does not erase the record; the sweep does not report it again.
      await reopenTicket(kit.as(member), { ticketId: ticket.id, reason: 'Still broken.' });
      kit.clock.advance(HOUR);
      expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
      expect((await getTicket(kit.as(mod), { ticketId: ticket.id })).sla?.state).toBe('breached');
      const stats = await getTicketStats(kit.as(ops));
      expect(stats.sla).toEqual({ decided: 1, breached: 1, breachRate: 1 });
    });

    it('an unanswered close before the deadline records no breach', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      kit.clock.advance(10 * MINUTE);
      await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Found the answer.' });
      expect((await row(ticket.id)).slaBreachedAt).toBeNull();
      expect((await getTicketStats(kit.as(ops))).sla).toEqual({
        decided: 0,
        breached: 0,
        breachRate: null,
      });
    });

    it('an on-time reply delivered after the sweep retracts the breach', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      const sentAt = new Date(ticket.createdAt.getTime() + 50 * MINUTE);
      kit.clock.advance((URGENT_SLA_MINUTES + 5) * MINUTE);
      expect((await runSlaSweep(botContext(kit))).breached).toEqual([ticket.id]);
      expect(await missedAlerts(mod.userId)).toHaveLength(1);

      // The bot was backlogged: the reply sent at +50 min only arrives now.
      await reply(threadId, mod, sentAt);

      const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
      expect(view.sla).toMatchObject({
        state: 'met',
        breachedAt: null,
        firstResponseAt: sentAt,
        firstResponseMinutes: 50,
      });
      expect(await ticketEventTypes(kit, ticket.id)).toEqual(
        expect.arrayContaining(['sla_breached', 'sla_breach_retracted']),
      );
      const [retracted] = await domainEventsOf('ticket.sla_breach_retracted', ticket.id);
      expect(retracted!.subjectMemberId).toBe(member.memberId);
      expect((await listTickets(kit.as(mod), { breached: true })).total).toBe(0);
      expect((await getTicketStats(kit.as(ops))).sla).toEqual({
        decided: 1,
        breached: 0,
        breachRate: 0,
      });

      // The retraction is staff-only and is described in the full transcript.
      const requesterView = await getTicket(kit.as(member), { ticketId: ticket.id });
      expect(requesterView.events.map((e) => e.type)).not.toContain('sla_breach_retracted');
      const requesterCopy = await renderTranscript(kit.as(member), {
        ticketId: ticket.id,
        format: 'markdown',
      });
      expect(requesterCopy.content).not.toContain('Missed-target');
      const full = await renderTranscript(kit.as(ops), {
        ticketId: ticket.id,
        format: 'markdown',
        includeInternal: true,
      });
      expect(full.content).toContain('Missed-target record withdrawn');
    });

    it('a reply sent before the close but delivered after it still counts', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      const sentAt = new Date(ticket.createdAt.getTime() + 50 * MINUTE);
      kit.clock.advance((URGENT_SLA_MINUTES + 10) * MINUTE);
      await closeTicket(kit.as(mod), { ticketId: ticket.id, reason: 'Answered in thread.' });
      expect((await row(ticket.id)).slaBreachedAt).not.toBeNull();

      const late = await reply(threadId, mod, sentAt);
      expect(late.firstResponse).toBe(true);
      const settled = await row(ticket.id);
      expect(settled).toMatchObject({ firstResponseAt: sentAt, slaBreachedAt: null });
    });

    it('BREAK: a handler message sent after the close is not a first response', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      kit.clock.advance((URGENT_SLA_MINUTES + 10) * MINUTE);
      await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'No answer.' });
      kit.clock.advance(MINUTE);
      const after = await reply(threadId, mod);
      expect(after.firstResponse).toBe(false);
      const closed = await row(ticket.id);
      expect(closed.firstResponseAt).toBeNull();
      expect(closed.slaBreachedAt).toEqual(closed.slaFirstResponseDueAt);
    });

    it('out-of-order delivery: the earliest handler reply is the first response', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      const early = new Date(ticket.createdAt.getTime() + 55 * MINUTE);
      const lateSent = new Date(ticket.createdAt.getTime() + 70 * MINUTE);
      kit.clock.advance(75 * MINUTE);

      expect((await reply(threadId, mod, lateSent)).firstResponse).toBe(true);
      expect((await row(ticket.id)).slaBreachedAt).not.toBeNull();
      expect((await reply(threadId, mod, early)).firstResponse).toBe(true);
      expect(await row(ticket.id)).toMatchObject({ firstResponseAt: early, slaBreachedAt: null });

      // A later reply never moves the first response.
      const later = new Date(ticket.createdAt.getTime() + 72 * MINUTE);
      expect((await reply(threadId, mod, later)).firstResponse).toBe(false);
      expect((await row(ticket.id)).firstResponseAt).toEqual(early);
    });

    it('BREAK: sent times are clamped to [opened, now] before they decide the outcome', async () => {
      const ticket = await openAs(kit, member, { priority: 'urgent' });
      const threadId = await provisionThread(kit, ticket.id);
      kit.clock.advance(10 * MINUTE);
      await reply(threadId, mod, new Date(kit.clock.now().getTime() + 5 * HOUR));
      expect((await row(ticket.id)).firstResponseAt).toEqual(kit.clock.now());
      expect((await row(ticket.id)).slaBreachedAt).toBeNull();

      const second = await openAs(kit, member, { priority: 'urgent' });
      const secondThread = await provisionThread(kit, second.id);
      kit.clock.advance(2 * HOUR);
      await reply(secondThread, mod, new Date(second.createdAt.getTime() - HOUR));
      // Clamped to the opening time: a 0-minute reply is the most it can claim.
      expect((await row(second.id)).firstResponseAt).toEqual(second.createdAt);
    });
  },
);
