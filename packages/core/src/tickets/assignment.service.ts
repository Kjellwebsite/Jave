import type { z } from 'zod';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { resolveUserActor } from '../identity/users.service';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import {
  assertActive,
  forbidTicket,
  isAssignee,
  loadTicket,
  requireHandler,
  ticketTransaction,
} from './access';
import { ALERT_PRIORITIES, PRIORITY_ORDINAL } from './constants';
import { ticketCopy } from './copy';
import { refreshCard, saveTicket } from './effects';
import { alertTicketStaff, appendTicketEvent, notifyTicketUpdate } from './records';
import {
  reasonedActionSchema,
  setPrioritySchema,
  ticketRefSchema,
  transferTicketSchema,
} from './schemas';
import { firstResponseDueAt } from './sla';
import { assignedStatus, resumedStatus, unassignedStatus } from './state';
import { type TicketSummary, ticketSummaryFor } from './views';

/**
 * Claim an unassigned active ticket. Claiming your own claim again is a
 * no-op (double-clicked CLAIM); a ticket held by someone else needs a transfer.
 */
export async function claimTicket(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketSummary> {
  const data = parseInput(ticketRefSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  const actor = requireUser(ctx);
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    requireHandler(tx, ticket, 'any');
    assertActive(ticket);
    if (isAssignee(tx, ticket)) return ticketSummaryFor(tx, ticket, 'handler');
    if (ticket.assigneeUserId) {
      throw new ConflictError(
        'Already claimed by another handler. A ticket manager can transfer it.',
      );
    }
    const claimed = await saveTicket(tx, ticket.id, {
      assigneeUserId: actor.userId,
      status: assignedStatus(ticket),
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'claimed', {
      assigneeUserId: actor.userId,
    });
    await recordAudit(tx, {
      action: 'ticket.claimed',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number },
    });
    await publishEvent(tx, {
      type: 'ticket.claimed',
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      subjectMemberId: actor.memberId,
      payload: { ticketId: ticket.id, number: ticket.number, assigneeUserId: actor.userId },
    });
    await refreshCard(tx, claimed, 'claimed', eventId);
    await notifyTicketUpdate(
      tx,
      claimed,
      ticket.openerUserId,
      ticketCopy.claimed(ticket.number, actor.displayName),
      eventId,
    );
    return ticketSummaryFor(tx, claimed, 'handler');
  });
}

/** Release a claim. The assignee, or a ticket manager (who then informs the former assignee). */
export async function unclaimTicket(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketSummary> {
  const data = parseInput(ticketRefSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    const access = requireHandler(tx, ticket, 'assignment');
    assertActive(ticket);
    if (!ticket.assigneeUserId) throw new InvalidStateError('This ticket is not claimed.');
    if (access !== 'manager' && !isAssignee(tx, ticket)) {
      return forbidTicket(ticket.id, 'not_assignee', 'Only the assignee can release it.');
    }
    const released = await saveTicket(tx, ticket.id, {
      assigneeUserId: null,
      status: unassignedStatus(ticket),
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'unclaimed', {
      previousAssigneeUserId: ticket.assigneeUserId,
    });
    await recordAudit(tx, {
      action: 'ticket.unclaimed',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, previousAssigneeUserId: ticket.assigneeUserId },
    });
    await refreshCard(tx, released, 'unclaimed', eventId);
    await notifyTicketUpdate(
      tx,
      released,
      ticket.assigneeUserId,
      ticketCopy.unassigned(ticket.number),
      eventId,
    );
    return ticketSummaryFor(tx, released, 'handler');
  });
}

/**
 * Hand a ticket to another handler. Allowed for ticket managers and for the
 * current assignee; the target must currently hold canHandleTickets and must
 * not be the ticket's opener.
 */
export async function transferTicket(
  ctx: ServiceContext,
  input: z.input<typeof transferTicketSchema>,
): Promise<TicketSummary> {
  const data = parseInput(transferTicketSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    const access = requireHandler(tx, ticket, 'any');
    if (access !== 'manager' && !isAssignee(tx, ticket)) {
      return forbidTicket(
        ticket.id,
        'transfer_requires_assignee_or_manager',
        'Only the assignee or a ticket manager can transfer this ticket.',
      );
    }
    assertActive(ticket);
    if (data.toUserId === ticket.openerUserId) {
      throw new ValidationError('The requester cannot handle their own ticket.');
    }
    if (data.toUserId === ticket.assigneeUserId) {
      throw new ConflictError('The ticket is already assigned to that handler.');
    }
    const target = await resolveUserActor(tx, data.toUserId).catch((error: unknown) => {
      if (error instanceof NotFoundError) throw new ValidationError('Unknown transfer target.');
      throw error;
    });
    if (!target.capabilities.has('canHandleTickets')) {
      throw new ValidationError('Transfer target must be able to handle tickets.');
    }
    const transferred = await saveTicket(tx, ticket.id, {
      assigneeUserId: target.userId,
      status: assignedStatus(ticket),
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'transferred', {
      fromUserId: ticket.assigneeUserId,
      toUserId: target.userId,
      reason: data.reason ?? null,
    });
    await recordAudit(tx, {
      action: 'ticket.transferred',
      targetType: 'ticket',
      targetId: ticket.id,
      context: {
        number: ticket.number,
        fromUserId: ticket.assigneeUserId,
        toUserId: target.userId,
        reason: data.reason,
      },
    });
    await publishEvent(tx, {
      type: 'ticket.transferred',
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      subjectMemberId: target.memberId,
      payload: {
        ticketId: ticket.id,
        number: ticket.number,
        fromUserId: ticket.assigneeUserId,
        toUserId: target.userId,
      },
    });
    await refreshCard(tx, transferred, 'transferred', eventId);
    await notifyTicketUpdate(
      tx,
      transferred,
      target.userId,
      ticketCopy.transferred(ticket.number, ticket.subject),
      eventId,
    );
    return ticketSummaryFor(tx, transferred, 'handler');
  });
}

/**
 * Change priority. While the ticket is still unanswered and within target,
 * the first-response deadline is recomputed from the opening time. A recorded
 * breach is never erased. Escalations to high/urgent alert staff.
 */
export async function setPriority(
  ctx: ServiceContext,
  input: z.input<typeof setPrioritySchema>,
): Promise<TicketSummary> {
  const data = parseInput(setPrioritySchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  const settings = await getSettings(ctx, 'tickets');
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    requireHandler(tx, ticket, 'assignment');
    assertActive(ticket);
    if (ticket.priority === data.priority) return ticketSummaryFor(tx, ticket, 'handler');
    const recompute = !ticket.firstResponseAt && !ticket.slaBreachedAt;
    const updated = await saveTicket(tx, ticket.id, {
      priority: data.priority,
      ...(recompute && {
        slaFirstResponseDueAt: firstResponseDueAt(
          ticket.createdAt,
          data.priority,
          settings.slaMinutes,
        ),
      }),
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'priority_changed', {
      from: ticket.priority,
      to: data.priority,
      slaFirstResponseDueAt: updated.slaFirstResponseDueAt?.toISOString() ?? null,
    });
    await recordAudit(tx, {
      action: 'ticket.priority_changed',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, from: ticket.priority, to: data.priority },
    });
    await refreshCard(tx, updated, 'priority_changed', eventId);
    const escalated = PRIORITY_ORDINAL[data.priority] > PRIORITY_ORDINAL[ticket.priority];
    if (escalated && ALERT_PRIORITIES.includes(data.priority)) {
      await alertTicketStaff(
        tx,
        updated,
        ticketCopy.escalated(ticket.number, data.priority),
        `ticket:${ticket.id}:event:${eventId}`,
      );
    }
    return ticketSummaryFor(tx, updated, 'handler');
  });
}

/**
 * Put the ticket on the requester: the reason is shown to them in the thread
 * and by notification, so it counts as a first response. The requester's next
 * message resumes the ticket automatically.
 */
export async function setWaiting(
  ctx: ServiceContext,
  input: z.input<typeof reasonedActionSchema>,
): Promise<TicketSummary> {
  const data = parseInput(reasonedActionSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    requireHandler(tx, ticket, 'assignment');
    assertActive(ticket);
    if (ticket.status === 'waiting') {
      throw new InvalidStateError('This ticket is already waiting on the requester.');
    }
    const now = tx.clock.now();
    const waiting = await saveTicket(tx, ticket.id, {
      status: 'waiting',
      firstResponseAt: ticket.firstResponseAt ?? now,
      lastActivityAt: now,
    });
    const eventId = await appendTicketEvent(tx, ticket.id, 'status_changed', {
      from: ticket.status,
      to: 'waiting',
      reason: data.reason,
    });
    await refreshCard(tx, waiting, 'waiting', eventId, data.reason);
    await notifyTicketUpdate(
      tx,
      waiting,
      ticket.openerUserId,
      ticketCopy.waiting(ticket.number, data.reason),
      eventId,
    );
    return ticketSummaryFor(tx, waiting, 'handler');
  });
}

/** Take a waiting ticket back without a requester reply (e.g. they answered elsewhere). */
export async function resumeTicket(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketSummary> {
  const data = parseInput(ticketRefSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    requireHandler(tx, ticket, 'assignment');
    if (ticket.status !== 'waiting') {
      throw new InvalidStateError('Only a waiting ticket can be resumed.');
    }
    const resumed = await saveTicket(tx, ticket.id, { status: resumedStatus(ticket) });
    const eventId = await appendTicketEvent(tx, ticket.id, 'status_changed', {
      from: 'waiting',
      to: resumed.status,
      trigger: 'handler',
    });
    await refreshCard(tx, resumed, 'resumed', eventId);
    return ticketSummaryFor(tx, resumed, 'handler');
  });
}
