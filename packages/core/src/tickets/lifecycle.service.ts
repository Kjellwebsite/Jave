import type { z } from 'zod';
import { ticketMessages, tickets } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { resolveUserActor } from '../identity/users.service';
import type { ServiceContext } from '../kernel/context';
import { DisabledError, InvalidStateError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, requireMember, requireUser } from '../permissions/authorize';
import { actorUserId } from '../permissions/actor';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import { getSettings } from '../settings/settings.service';
import {
  assertActive,
  assertBelowOpenLimit,
  assertRequesterStanding,
  loadTicket,
  requireParticipant,
  type TicketRecord,
  ticketTransaction,
} from './access';
import { ALERT_PRIORITIES, OPEN_RATE_WINDOW_SECONDS, ticketReference } from './constants';
import { ticketCopy } from './copy';
import {
  saveTicket,
  scheduleCloseThread,
  scheduleOpenThread,
  scheduleReopenThread,
} from './effects';
import {
  alertTicketStaff,
  appendTicketEvent,
  memberIdForUser,
  notifyTicketUpdate,
} from './records';
import {
  type OpenTicketInput,
  openTicketSchema,
  reasonedActionSchema,
  ticketRefSchema,
} from './schemas';
import { firstResponseDueAt } from './sla';
import { recordSlaOutcome, slaBreachPatch } from './sla-outcome';
import { resumedStatus } from './state';
import { type TicketSummary, ticketSummaryFor } from './views';

/**
 * Open a ticket as yourself. The opening message is stored as the first
 * transcript entry; the private thread is provisioned by the bot.
 */
export async function openTicket(
  ctx: ServiceContext,
  input: OpenTicketInput,
): Promise<TicketSummary> {
  const data = parseInput(openTicketSchema, input);
  const actor = requireMember(ctx);
  assertRequesterStanding(actor);
  const settings = await getSettings(ctx, 'tickets');
  if (!settings.enabled) throw new DisabledError('Tickets');
  const channels = await getSettings(ctx, 'channels');
  if (!channels.tickets) {
    throw new InvalidStateError('Tickets are not set up yet: no ticket channel is configured.');
  }
  await consumeRateLimit(
    ctx,
    `tickets:open:${actor.userId}`,
    settings.openRatePerHour,
    OPEN_RATE_WINDOW_SECONDS,
  );

  return ticketTransaction(ctx, async (tx) => {
    await assertBelowOpenLimit(tx, actor.userId, settings.maxOpenPerUser);
    const now = tx.clock.now();
    const [ticket] = await tx.db
      .insert(tickets)
      .values({
        category: data.category,
        priority: data.priority,
        status: 'open',
        subject: data.subject,
        openerUserId: actor.userId,
        discordChannelId: channels.tickets,
        slaFirstResponseDueAt: firstResponseDueAt(now, data.priority, settings.slaMinutes),
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const created = ticket!;
    await tx.db.insert(ticketMessages).values({
      ticketId: created.id,
      authorUserId: actor.userId,
      authorRole: 'requester',
      body: data.body,
      createdAt: now,
    });
    await appendTicketEvent(tx, created.id, 'created', {
      category: data.category,
      priority: data.priority,
    });
    await publishEvent(tx, {
      type: 'ticket.opened',
      aggregateType: 'ticket',
      aggregateId: created.id,
      subjectMemberId: actor.memberId,
      payload: {
        ticketId: created.id,
        number: created.number,
        category: created.category,
        priority: created.priority,
      },
    });
    await scheduleOpenThread(tx, created);
    if (ALERT_PRIORITIES.includes(created.priority)) {
      await alertTicketStaff(
        tx,
        created,
        ticketCopy.opened(created.number, created.priority, created.subject),
        `ticket:${created.id}:opened`,
      );
    }
    return ticketSummaryFor(tx, created, 'requester');
  });
}

/** The person on the other side of an action: the opener, or the assignee when the opener acted. */
function counterpart(ctx: ServiceContext, ticket: TicketRecord): string | null {
  return actorUserId(ctx.actor) === ticket.openerUserId
    ? ticket.assigneeUserId
    : ticket.openerUserId;
}

/** Close a ticket. Opener, the assignee, a handler of an unassigned ticket, or a ticket manager. */
export async function closeTicket(
  ctx: ServiceContext,
  input: z.input<typeof reasonedActionSchema>,
): Promise<TicketSummary> {
  const data = parseInput(reasonedActionSchema, input);
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    const role = requireParticipant(tx, ticket);
    assertActive(ticket);
    const now = tx.clock.now();
    const closed = await saveTicket(tx, ticket.id, {
      status: 'closed',
      closedAt: now,
      closedByUserId: actorUserId(tx.actor),
      closeReason: data.reason,
      lastActivityAt: now,
      // Closing an unanswered ticket after its deadline settles it as breached.
      ...slaBreachPatch({ ...ticket, closedAt: now }),
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'closed', { reason: data.reason });
    await recordSlaOutcome(tx, ticket, closed, 'close');
    await recordAudit(tx, {
      action: 'ticket.closed',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, from: ticket.status, reason: data.reason, as: role },
    });
    await publishEvent(tx, {
      type: 'ticket.closed',
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      subjectMemberId: await memberIdForUser(tx, ticket.openerUserId),
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        category: ticket.category,
        closedBy: role,
        answered: ticket.firstResponseAt !== null,
      },
    });
    await scheduleCloseThread(tx, closed, eventId);
    await notifyTicketUpdate(
      tx,
      closed,
      counterpart(tx, ticket),
      ticketCopy.closed(ticket.number, data.reason),
      eventId,
    );
    return ticketSummaryFor(tx, closed, role === 'requester' ? 'requester' : 'handler');
  });
}

/**
 * Reopen a closed (not archived) ticket. The opener is held to
 * settings.tickets.maxOpenPerUser; the assignee, if any, keeps the ticket.
 */
export async function reopenTicket(
  ctx: ServiceContext,
  input: z.input<typeof reasonedActionSchema>,
): Promise<TicketSummary> {
  const data = parseInput(reasonedActionSchema, input);
  const settings = await getSettings(ctx, 'tickets');
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    const role = requireParticipant(tx, ticket);
    if (ticket.status === 'archived') {
      throw new InvalidStateError(
        `Ticket ${ticketReference(ticket.number)} is archived. Open a new ticket instead.`,
      );
    }
    if (ticket.status !== 'closed') {
      throw new InvalidStateError(`Ticket ${ticketReference(ticket.number)} is not closed.`);
    }
    if (role === 'requester') {
      assertRequesterStanding(requireUser(tx));
      await assertBelowOpenLimit(tx, ticket.openerUserId, settings.maxOpenPerUser);
    }
    // The former assignee keeps the ticket only while they can still handle tickets.
    const keepAssignee = ticket.assigneeUserId
      ? (await resolveUserActor(tx, ticket.assigneeUserId)).capabilities.has('canHandleTickets')
      : false;
    const assigneeUserId = keepAssignee ? ticket.assigneeUserId : null;
    const reopened = await saveTicket(tx, ticket.id, {
      status: resumedStatus({ status: ticket.status, assigneeUserId }),
      assigneeUserId,
      closedAt: null,
      closedByUserId: null,
      closeReason: null,
      reopenCount: ticket.reopenCount + 1,
      lastActivityAt: tx.clock.now(),
    });
    if (ticket.assigneeUserId && !keepAssignee) {
      // Staff-only timeline entry: the requester's view does not show 'unclaimed'.
      await appendTicketEvent(tx, ticket.id, 'unclaimed', {
        previousAssigneeUserId: ticket.assigneeUserId,
        trigger: 'reopen_without_handler_rights',
      });
    }
    const eventId = await appendTicketEvent(tx, ticket.id, 'reopened', { reason: data.reason });
    await recordAudit(tx, {
      action: 'ticket.reopened',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, reason: data.reason, as: role },
    });
    await publishEvent(tx, {
      type: 'ticket.reopened',
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      subjectMemberId: await memberIdForUser(tx, ticket.openerUserId),
      payload: { ticketId: ticket.id, number: ticket.number, reopenCount: reopened.reopenCount },
    });
    await scheduleReopenThread(tx, reopened, data.reason, eventId);
    await notifyTicketUpdate(
      tx,
      reopened,
      counterpart(tx, reopened),
      ticketCopy.reopened(ticket.number, data.reason),
      eventId,
    );
    return ticketSummaryFor(tx, reopened, role === 'requester' ? 'requester' : 'handler');
  });
}

/** Archive a closed ticket now instead of waiting for the sweep. Ticket managers only. */
export async function archiveTicket(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketSummary> {
  const data = parseInput(ticketRefSchema, input);
  await authorize(ctx, 'canManageTickets', { type: 'ticket', id: data.ticketId });
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    if (ticket.status !== 'closed') {
      throw new InvalidStateError('Only closed tickets can be archived.');
    }
    const archived = await saveTicket(tx, ticket.id, {
      status: 'archived',
      archivedAt: tx.clock.now(),
    });
    await appendTicketEvent(tx, ticket.id, 'archived', { automatic: false });
    await recordAudit(tx, {
      action: 'ticket.archived',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number },
    });
    return ticketSummaryFor(tx, archived, 'handler');
  });
}
