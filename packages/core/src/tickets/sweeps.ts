import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { tickets } from '@jave/database';
import { publishEvent } from '../events/bus';
import { DAY } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { getSettings } from '../settings/settings.service';
import { requireSystemActor } from './access';
import {
  ACTIVE_STATUSES,
  ARCHIVE_SWEEP_EVERY_MS,
  ARCHIVE_SWEEP_JOB,
  SLA_SWEEP_EVERY_MS,
  SLA_SWEEP_JOB,
  SWEEP_BATCH_SIZE,
} from './constants';
import { ticketCopy } from './copy';
import { alertTicketStaff, appendTicketEvent, memberIdForUser } from './records';

const slaEligible = (now: Date) =>
  and(
    inArray(tickets.status, [...ACTIVE_STATUSES]),
    isNull(tickets.firstResponseAt),
    isNull(tickets.slaBreachedAt),
    isNotNull(tickets.slaFirstResponseDueAt),
    lt(tickets.slaFirstResponseDueAt, now),
  );

/**
 * Mark unanswered tickets whose first-response target has passed. Each ticket
 * is flipped by a conditional update in its own transaction, so concurrent
 * sweeps (or a reply racing the sweep) can never double-report a breach. The
 * breach time recorded is the deadline itself, independent of sweep latency.
 */
export async function runSlaSweep(ctx: ServiceContext): Promise<{ breached: string[] }> {
  await requireSystemActor(ctx, 'tickets.slaSweep');
  const now = ctx.clock.now();
  const candidates = await ctx.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(slaEligible(now))
    .orderBy(asc(tickets.slaFirstResponseDueAt))
    .limit(SWEEP_BATCH_SIZE);
  const breached: string[] = [];
  for (const { id } of candidates) {
    const flipped = await withTransaction(ctx, async (tx) => {
      const [ticket] = await tx.db
        .update(tickets)
        .set({ slaBreachedAt: sql`${tickets.slaFirstResponseDueAt}`, updatedAt: now })
        .where(and(eq(tickets.id, id), slaEligible(now)))
        .returning();
      if (!ticket) return false;
      await appendTicketEvent(tx, ticket.id, 'sla_breached', {
        priority: ticket.priority,
        dueAt: ticket.slaFirstResponseDueAt?.toISOString() ?? null,
      });
      await publishEvent(tx, {
        type: 'ticket.sla_breached',
        aggregateType: 'ticket',
        aggregateId: ticket.id,
        subjectMemberId: await memberIdForUser(tx, ticket.openerUserId),
        payload: {
          ticketId: ticket.id,
          number: ticket.number,
          priority: ticket.priority,
          assigned: ticket.assigneeUserId !== null,
        },
      });
      await alertTicketStaff(
        tx,
        ticket,
        ticketCopy.slaBreached(ticket.number, ticket.priority),
        `ticket:${ticket.id}:sla-breach`,
      );
      return true;
    });
    if (flipped) breached.push(id);
  }
  return { breached };
}

/** Archive tickets closed for longer than settings.tickets.archiveAfterDays. */
export async function runArchiveSweep(ctx: ServiceContext): Promise<{ archived: string[] }> {
  await requireSystemActor(ctx, 'tickets.archiveSweep');
  const settings = await getSettings(ctx, 'tickets');
  const now = ctx.clock.now();
  const cutoff = new Date(now.getTime() - settings.archiveAfterDays * DAY);
  const due = and(eq(tickets.status, 'closed'), lt(tickets.closedAt, cutoff));
  const candidates = await ctx.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(due)
    .orderBy(asc(tickets.closedAt))
    .limit(SWEEP_BATCH_SIZE);
  const archived: string[] = [];
  for (const { id } of candidates) {
    const flipped = await withTransaction(ctx, async (tx) => {
      const [ticket] = await tx.db
        .update(tickets)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(and(eq(tickets.id, id), due))
        .returning({ id: tickets.id });
      if (!ticket) return false;
      await appendTicketEvent(tx, ticket.id, 'archived', { automatic: true });
      return true;
    });
    if (flipped) archived.push(id);
  }
  return { archived };
}

export const sweepJobHandlers: JobHandlerMap = {
  [SLA_SWEEP_JOB]: async (ctx) => runSlaSweep(ctx),
  [ARCHIVE_SWEEP_JOB]: async (ctx) => runArchiveSweep(ctx),
};

export const sweepRecurringJobs: readonly RecurringJob[] = [
  { type: SLA_SWEEP_JOB, everyMs: SLA_SWEEP_EVERY_MS },
  { type: ARCHIVE_SWEEP_JOB, everyMs: ARCHIVE_SWEEP_EVERY_MS },
];
