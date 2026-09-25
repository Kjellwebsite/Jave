import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { domainEvents, tickets } from '@jave/database';
import { HOUR, MINUTE } from '../kernel/clock';
import { ForbiddenError } from '../kernel/errors';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import { claimTicket, setPriority, setWaiting } from './assignment.service';
import { ARCHIVE_SWEEP_JOB, SLA_SWEEP_JOB } from './constants';
import { coreJobHandlers, coreRecurringJobs } from '../registry';
import { recurringJobs, jobHandlers } from './index';
import { closeTicket } from './lifecycle.service';
import { recordMessage } from './messages.service';
import { getTicket, getTicketStats } from './queries.service';
import { firstResponseDueAt, isOverdue, minutesBetween, slaState } from './sla';
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
import { enqueueJob } from '../jobs/queue';

const SLA = { low: 2880, normal: 1440, high: 240, urgent: 60 };

describe('tickets: SLA (pure)', () => {
  const opened = new Date('2026-03-01T12:00:00.000Z');

  it('computes the due time from the priority', () => {
    expect(firstResponseDueAt(opened, 'urgent', SLA).toISOString()).toBe(
      '2026-03-01T13:00:00.000Z',
    );
    expect(firstResponseDueAt(opened, 'low', SLA).toISOString()).toBe('2026-03-03T12:00:00.000Z');
  });

  it('derives state with breach taking precedence and being permanent', () => {
    const due = new Date(opened.getTime() + HOUR);
    expect(
      slaState({ slaFirstResponseDueAt: null, firstResponseAt: null, slaBreachedAt: null }),
    ).toBe('none');
    expect(
      slaState({ slaFirstResponseDueAt: due, firstResponseAt: null, slaBreachedAt: null }),
    ).toBe('pending');
    expect(
      slaState({ slaFirstResponseDueAt: due, firstResponseAt: due, slaBreachedAt: null }),
    ).toBe('met');
    expect(slaState({ slaFirstResponseDueAt: due, firstResponseAt: due, slaBreachedAt: due })).toBe(
      'breached',
    );
  });

  it('is not overdue exactly at the deadline, only after it', () => {
    const due = new Date(opened.getTime() + HOUR);
    const fields = { slaFirstResponseDueAt: due, firstResponseAt: null, slaBreachedAt: null };
    expect(isOverdue(fields, due)).toBe(false);
    expect(isOverdue(fields, new Date(due.getTime() + 1))).toBe(true);
    expect(isOverdue({ ...fields, firstResponseAt: opened }, new Date(due.getTime() + 1))).toBe(
      false,
    );
  });

  it('measures minutes with one decimal', () => {
    expect(minutesBetween(opened, new Date(opened.getTime() + 90_000))).toBe(1.5);
  });
});

describe('tickets: SLA sweep', INTEGRATION_SUITE, () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTicketKit();
  }, INTEGRATION_HOOK_TIMEOUT);
  afterEach(async () => {
    await kit.close();
  }, INTEGRATION_HOOK_TIMEOUT);

  it('registers a recurring sweep every 5 minutes, wired into the core registry', () => {
    expect(recurringJobs.find((j) => j.type === SLA_SWEEP_JOB)?.everyMs).toBe(5 * MINUTE);
    expect(jobHandlers[SLA_SWEEP_JOB]).toBeTypeOf('function');
    const registry = coreJobHandlers();
    expect(registry[SLA_SWEEP_JOB]).toBe(jobHandlers[SLA_SWEEP_JOB]);
    expect(registry[ARCHIVE_SWEEP_JOB]).toBe(jobHandlers[ARCHIVE_SWEEP_JOB]);
    expect(coreRecurringJobs.map((j) => j.type)).toEqual(
      expect.arrayContaining([SLA_SWEEP_JOB, ARCHIVE_SWEEP_JOB]),
    );
  });

  it('breaches exactly after the deadline, once, and alerts all handlers when unassigned', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const member = await kit.member();
    const ticket = await openAs(kit, member, { priority: 'urgent' });
    const alertsBefore = (await notificationsFor(kit, mod.userId)).length;

    kit.clock.advance(60 * MINUTE);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
    kit.clock.advance(1);
    const beforeSweep = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(beforeSweep.sla).toMatchObject({ state: 'pending', overdue: true });
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([ticket.id]);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);

    const [row] = await kit.db.select().from(tickets).where(eq(tickets.id, ticket.id));
    // The breach time is the deadline itself, not the sweep time.
    expect(row!.slaBreachedAt).toEqual(row!.slaFirstResponseDueAt);
    expect(await ticketEventTypes(kit, ticket.id)).toContain('sla_breached');
    const alerts = await notificationsFor(kit, mod.userId);
    expect(alerts.length - alertsBefore).toBe(1);
    expect(alerts.at(-1)!.title).toBe(`TICKET ${ticket.reference} — RESPONSE TARGET MISSED`);
    const [event] = await kit.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'ticket.sla_breached'));
    expect(event!.subjectMemberId).toBe(member.memberId);
    expect(await notificationsFor(kit, member.userId)).toHaveLength(0);
  });

  it('alerts only the assignee when the ticket is claimed', async () => {
    const modA = await kit.member({ roles: ['moderator'] });
    const modB = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, await kit.member(), { priority: 'high' });
    await claimTicket(kit.as(modA), { ticketId: ticket.id });
    const bBefore = (await notificationsFor(kit, modB.userId)).length;
    kit.clock.advance(5 * HOUR);
    await runSlaSweep(botContext(kit));
    const aAlerts = (await notificationsFor(kit, modA.userId)).filter((n) =>
      n.title.endsWith('RESPONSE TARGET MISSED'),
    );
    expect(aAlerts).toHaveLength(1);
    expect((await notificationsFor(kit, modB.userId)).length).toBe(bBefore);
  });

  it('a handler reply before the deadline prevents the breach', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const member = await kit.member();
    const ticket = await openAs(kit, member, { priority: 'urgent' });
    const threadId = await provisionThread(kit, ticket.id);
    kit.clock.advance(59 * MINUTE);
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(mod),
      body: 'On it.',
    });
    kit.clock.advance(HOUR);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
    const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(view.sla).toMatchObject({ state: 'met', overdue: false, firstResponseMinutes: 59 });
  });

  it('setWaiting counts as the first response', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, await kit.member(), { priority: 'urgent' });
    kit.clock.advance(30 * MINUTE);
    await setWaiting(kit.as(mod), { ticketId: ticket.id, reason: 'Which account?' });
    kit.clock.advance(2 * HOUR);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
  });

  it('closed tickets are never breached', async () => {
    const member = await kit.member();
    const ticket = await openAs(kit, member, { priority: 'urgent' });
    await closeTicket(kit.as(member), { ticketId: ticket.id, reason: 'Found the answer.' });
    kit.clock.advance(2 * HOUR);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);
  });

  it('downgrading priority extends an unbreached SLA; a recorded breach stays', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const first = await openAs(kit, await kit.member(), { priority: 'urgent' });
    kit.clock.advance(30 * MINUTE);
    const lowered = await setPriority(kit.as(mod), { ticketId: first.id, priority: 'low' });
    expect(lowered.sla!.dueAt!.getTime()).toBe(first.createdAt.getTime() + 2880 * MINUTE);
    kit.clock.advance(HOUR);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([]);

    const second = await openAs(kit, await kit.member(), { priority: 'urgent' });
    kit.clock.advance(2 * HOUR);
    expect((await runSlaSweep(botContext(kit))).breached).toEqual([second.id]);
    const after = await setPriority(kit.as(mod), { ticketId: second.id, priority: 'low' });
    expect(after.sla?.state).toBe('breached');
    expect(after.sla!.dueAt!.getTime()).toBe(second.createdAt.getTime() + 60 * MINUTE);
  });

  it('uses the configured SLA minutes', async () => {
    await updateSettings(kit.system, 'tickets', {
      slaMinutes: { low: 100, normal: 50, high: 20, urgent: 10 },
    });
    const mod = await kit.member({ roles: ['moderator'] });
    const ticket = await openAs(kit, await kit.member(), { priority: 'high' });
    const view = await getTicket(kit.as(mod), { ticketId: ticket.id });
    expect(view.sla!.dueAt!.getTime() - view.createdAt.getTime()).toBe(20 * MINUTE);
  });

  it('runs through the job queue with a system actor', async () => {
    const ticket = await openAs(kit, await kit.member(), { priority: 'urgent' });
    kit.clock.advance(2 * HOUR);
    await enqueueJob(kit.system, SLA_SWEEP_JOB, {});
    const outcomes = await kit.drain(jobHandlers);
    const sweep = outcomes.find((o) => o.type === SLA_SWEEP_JOB);
    expect(sweep?.status).toBe('completed');
    expect(sweep?.result).toEqual({ breached: [ticket.id] });
  });

  it('BREAK: users cannot trigger the sweep directly', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    await expect(runSlaSweep(kit.as(ops))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('feeds median first response and breach rate into stats', async () => {
    const mod = await kit.member({ roles: ['moderator'] });
    const ops = await kit.member({ roles: ['operations'] });
    const answered = await openAs(kit, await kit.member(), { priority: 'urgent' });
    const threadId = await provisionThread(kit, answered.id);
    const late = await openAs(kit, await kit.member(), { priority: 'urgent' });
    await openAs(kit, await kit.member(), { priority: 'low', category: 'partnership' });
    kit.clock.advance(20 * MINUTE);
    await recordMessage(botContext(kit), {
      threadId,
      discordMessageId: nextSnowflake(),
      author: authorOf(mod),
      body: 'Answering.',
    });
    kit.clock.advance(HOUR);
    await runSlaSweep(botContext(kit));
    const stats = await getTicketStats(kit.as(ops));
    expect(stats.opened).toBe(3);
    expect(stats.active).toMatchObject({ total: 3, open: 3, unassigned: 3 });
    expect(stats.firstResponse).toEqual({ responded: 1, medianMinutes: 20 });
    expect(stats.sla).toEqual({ decided: 2, breached: 1, breachRate: 0.5 });
    expect(stats.byCategory.partnership).toBe(1);
    expect(stats.byCategory.technical).toBe(2);
    expect(stats.byPriority.urgent).toBe(2);
    expect(late.status).toBe('open');
  });
});
