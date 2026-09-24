import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ticketMessages, tickets } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, isUniqueViolation } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { can, requireUser } from '../permissions/authorize';
import {
  isActive,
  loadTicket,
  requireSystemActor,
  requireViewer,
  auditingDenials,
  ticketTransaction,
} from './access';
import {
  CARD_EXCERPT_LENGTH,
  type TicketCategory,
  type TicketPriority,
  ticketReference,
  type TicketStatus,
} from './constants';
import { refreshCard, saveTicket, scheduleCloseThread, scheduleOpenThread } from './effects';
import { userSummaries, type UserSummary } from './records';
import {
  markThreadCreatedSchema,
  markThreadMissingSchema,
  threadLookupSchema,
  ticketRefSchema,
} from './schemas';

/**
 * Everything the bot needs to render a ticket's Discord card. Contains only
 * requester-safe data: the card lives in the requester's thread.
 */
export interface TicketCard {
  ticketId: string;
  number: number;
  reference: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  opener: UserSummary | null;
  assignee: UserSummary | null;
  closedBy: UserSummary | null;
  closeReason: string | null;
  /** Excerpt of the opening message (the requester's own words). */
  openingMessage: string | null;
  parentChannelId: string | null;
  threadId: string | null;
  cardMessageId: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

/** Current card state for a ticket. The bot (system), the opener or a handler. */
export async function getTicketCard(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketCard> {
  const data = parseInput(ticketRefSchema, input);
  const ticket = await loadTicket(ctx, data.ticketId);
  await auditingDenials(ctx, async () => requireViewer(ctx, ticket));
  const [people, [opening]] = await Promise.all([
    userSummaries(ctx, [ticket.openerUserId, ticket.assigneeUserId, ticket.closedByUserId]),
    ctx.db
      .select({ body: ticketMessages.body })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.isInternal, false)))
      .orderBy(asc(ticketMessages.createdAt), asc(ticketMessages.seq))
      .limit(1),
  ]);
  return {
    ticketId: ticket.id,
    number: ticket.number,
    reference: ticketReference(ticket.number),
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    opener: people.get(ticket.openerUserId) ?? null,
    assignee: ticket.assigneeUserId ? (people.get(ticket.assigneeUserId) ?? null) : null,
    closedBy: ticket.closedByUserId ? (people.get(ticket.closedByUserId) ?? null) : null,
    closeReason: ticket.closeReason,
    openingMessage: opening ? truncate(opening.body, CARD_EXCERPT_LENGTH) : null,
    parentChannelId: ticket.discordChannelId,
    threadId: ticket.discordThreadId,
    cardMessageId: ticket.discordCardMessageId,
    createdAt: ticket.createdAt,
    closedAt: ticket.closedAt,
  };
}

/**
 * Ticket behind a Discord thread (for commands used inside a thread). Returns
 * null unless the caller may see that ticket, so it cannot be used to probe.
 */
export async function getTicketIdForThread(
  ctx: ServiceContext,
  input: z.input<typeof threadLookupSchema>,
): Promise<string | null> {
  const data = parseInput(threadLookupSchema, input);
  if (ctx.actor.kind !== 'system') requireUser(ctx);
  const [row] = await ctx.db
    .select({ id: tickets.id, openerUserId: tickets.openerUserId })
    .from(tickets)
    .where(eq(tickets.discordThreadId, data.threadId));
  if (!row) return null;
  const visible =
    ctx.actor.kind === 'system' ||
    (ctx.actor.kind === 'user' && ctx.actor.userId === row.openerUserId) ||
    can(ctx, 'canHandleTickets');
  return visible ? row.id : null;
}

export type ThreadCallbackResult =
  { status: 'recorded'; closeScheduled: boolean } | { status: 'unchanged' };

/**
 * Bot callback for discord.tickets.open_thread. Idempotent for the same
 * thread; a different thread for a ticket that already has one is a conflict.
 * Always schedules a card refresh (the ticket may have changed while the
 * thread was being created) and a close when the ticket closed meanwhile.
 */
export async function markThreadCreated(
  ctx: ServiceContext,
  input: z.input<typeof markThreadCreatedSchema>,
): Promise<ThreadCallbackResult> {
  await requireSystemActor(ctx, 'tickets.markThreadCreated');
  const data = parseInput(markThreadCreatedSchema, input);
  try {
    return await ticketTransaction(ctx, async (tx) => {
      const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
      if (ticket.discordThreadId === data.threadId) {
        if (data.cardMessageId && data.cardMessageId !== ticket.discordCardMessageId) {
          await saveTicket(tx, ticket.id, { discordCardMessageId: data.cardMessageId });
        }
        return { status: 'unchanged' } as const;
      }
      if (ticket.discordThreadId) {
        throw new ConflictError('This ticket already has a thread.');
      }
      const updated = await saveTicket(tx, ticket.id, {
        discordThreadId: data.threadId,
        discordCardMessageId: data.cardMessageId ?? null,
      });
      const anchor = `thread:${data.threadId}`;
      if (isActive(updated)) {
        await refreshCard(tx, updated, 'refresh', anchor);
        return { status: 'recorded', closeScheduled: false } as const;
      }
      const closeScheduled = await scheduleCloseThread(tx, updated, anchor);
      return { status: 'recorded', closeScheduled } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'tickets_thread_uq')) {
      throw new ConflictError('That thread already belongs to another ticket.');
    }
    throw error;
  }
}

/**
 * Bot callback when a ticket's thread no longer exists on Discord (deleted by
 * hand). Clears the stale reference and, for an active ticket, provisions a
 * fresh thread. Stale callbacks (a different thread) are ignored.
 */
export async function markThreadMissing(
  ctx: ServiceContext,
  input: z.input<typeof markThreadMissingSchema>,
): Promise<{ status: 'cleared'; reprovisioned: boolean } | { status: 'ignored' }> {
  await requireSystemActor(ctx, 'tickets.markThreadMissing');
  const data = parseInput(markThreadMissingSchema, input);
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId, { forUpdate: true });
    if (ticket.discordThreadId !== data.threadId) return { status: 'ignored' } as const;
    const cleared = await saveTicket(tx, ticket.id, {
      discordThreadId: null,
      discordCardMessageId: null,
    });
    await recordAudit(tx, {
      action: 'ticket.thread_missing',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, threadId: data.threadId, status: ticket.status },
    });
    const reprovisioned = isActive(cleared) ? await scheduleOpenThread(tx, cleared) : false;
    return { status: 'cleared', reprovisioned } as const;
  });
}
