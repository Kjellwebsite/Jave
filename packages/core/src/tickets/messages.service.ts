import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { ticketMessages, tickets } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { resolveUserActor, upsertDiscordUser } from '../identity/users.service';
import type { ServiceContext } from '../kernel/context';
import { InvalidStateError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { authorize, requireUser } from '../permissions/authorize';
import {
  isActive,
  loadTicket,
  requireHandler,
  requireSystemActor,
  type TicketRecord,
  ticketTransaction,
} from './access';
import { refreshCard, saveTicket } from './effects';
import { appendTicketEvent } from './records';
import { recordSlaOutcome, slaBreachPatch } from './sla-outcome';
import {
  internalNoteSchema,
  type RecordMessageInput,
  recordMessageDeleteSchema,
  recordMessageEditSchema,
  recordMessageSchema,
} from './schemas';
import { resumedStatus } from './state';
import type { TicketAuthorRole } from './views';

export type RecordOutcome =
  | { status: 'recorded'; messageId: string; ticketId: string }
  | { status: 'duplicate'; messageId: string; ticketId: string }
  | { status: 'ignored'; reason: IgnoreReason };

export type IgnoreReason =
  'not_a_ticket' | 'bot_author' | 'archived' | 'unknown_message' | 'deleted' | 'unchanged';

export interface RecordMessageResult {
  outcome: RecordOutcome;
  authorRole: TicketAuthorRole | null;
  /** This message was the first handler response. */
  firstResponse: boolean;
  /** The requester's reply moved the ticket out of 'waiting'. */
  resumed: boolean;
}

/** Discord timestamps are trusted only within [ticket opened, now]. */
function clampTime(value: Date | undefined, floor: Date, now: Date): Date {
  const time = value?.getTime() ?? now.getTime();
  return new Date(Math.min(Math.max(time, floor.getTime()), now.getTime()));
}

async function findByDiscordMessage(ctx: ServiceContext, discordMessageId: string) {
  const [row] = await ctx.db
    .select({ message: ticketMessages, ticketStatus: tickets.status })
    .from(ticketMessages)
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .where(eq(ticketMessages.discordMessageId, discordMessageId));
  return row ?? null;
}

async function resolveAuthorRole(
  ctx: ServiceContext,
  userId: string,
  openerUserId: string,
): Promise<TicketAuthorRole> {
  if (userId === openerUserId) return 'requester';
  const author = await resolveUserActor(ctx, userId);
  return author.capabilities.has('canHandleTickets') ? 'handler' : 'participant';
}

/**
 * A handler message sent at `sentAt` is the ticket's first response when it
 * was sent while the ticket was being worked on (active now, or sent before
 * its close) and earlier than any response recorded so far: the bot may
 * deliver messages late or out of order, so arrival order proves nothing.
 */
function isFirstResponse(ticket: TicketRecord, sentAt: Date): boolean {
  const sentWhileActive =
    isActive(ticket) || (ticket.closedAt !== null && sentAt.getTime() <= ticket.closedAt.getTime());
  return (
    sentWhileActive &&
    (ticket.firstResponseAt === null || sentAt.getTime() < ticket.firstResponseAt.getTime())
  );
}

/**
 * Bot callback for every message posted in a ticket thread. Idempotent on
 * the Discord message id. A handler's reply stamps firstResponseAt (by its
 * Discord send time) and settles the SLA outcome; the requester's reply takes
 * a waiting ticket back to staff. Attachments are stored as metadata only
 * (name, URL, size, type) — never downloaded.
 */
export async function recordMessage(
  ctx: ServiceContext,
  input: RecordMessageInput,
): Promise<RecordMessageResult> {
  await requireSystemActor(ctx, 'tickets.recordMessage');
  const data = parseInput(recordMessageSchema, input);
  const ignored = (reason: IgnoreReason): RecordMessageResult => ({
    outcome: { status: 'ignored', reason },
    authorRole: null,
    firstResponse: false,
    resumed: false,
  });
  const [ticket] = await ctx.db
    .select()
    .from(tickets)
    .where(eq(tickets.discordThreadId, data.threadId));
  if (!ticket) return ignored('not_a_ticket');
  if (data.author.bot) return ignored('bot_author');
  if (ticket.status === 'archived') return ignored('archived');
  const existing = await findByDiscordMessage(ctx, data.discordMessageId);
  if (existing) {
    return {
      outcome: {
        status: 'duplicate',
        messageId: existing.message.id,
        ticketId: existing.message.ticketId,
      },
      authorRole: existing.message.authorRole,
      firstResponse: false,
      resumed: false,
    };
  }
  const user = await upsertDiscordUser(ctx, {
    discordId: data.author.discordId,
    username: data.author.username,
    displayName: data.author.displayName ?? null,
    avatarHash: data.author.avatarHash ?? null,
  });
  const authorRole = await resolveAuthorRole(ctx, user.id, ticket.openerUserId);

  return ticketTransaction(ctx, async (tx) => {
    const locked = await loadTicket(tx, ticket.id, { forUpdate: true });
    if (locked.status === 'archived') return ignored('archived');
    const now = tx.clock.now();
    const sentAt = clampTime(data.sentAt, locked.createdAt, now);
    const [inserted] = await tx.db
      .insert(ticketMessages)
      .values({
        ticketId: locked.id,
        authorUserId: user.id,
        authorRole,
        discordMessageId: data.discordMessageId,
        body: data.body,
        attachments: data.attachments.map((a) => ({
          name: a.name,
          url: a.url,
          size: a.size,
          ...(a.contentType ? { contentType: a.contentType } : {}),
        })),
        createdAt: sentAt,
      })
      .onConflictDoNothing({ target: ticketMessages.discordMessageId })
      .returning({ id: ticketMessages.id });
    if (!inserted) {
      // A concurrent delivery of the same Discord message won the insert.
      const raced = await findByDiscordMessage(tx, data.discordMessageId);
      if (!raced) return ignored('unknown_message');
      return {
        outcome: {
          status: 'duplicate',
          messageId: raced.message.id,
          ticketId: raced.message.ticketId,
        },
        authorRole: raced.message.authorRole,
        firstResponse: false,
        resumed: false,
      } satisfies RecordMessageResult;
    }
    const firstResponse = authorRole === 'handler' && isFirstResponse(locked, sentAt);
    const resumed = authorRole === 'requester' && locked.status === 'waiting';
    const lastActivityAt = sentAt > locked.lastActivityAt ? sentAt : locked.lastActivityAt;
    const updated = await saveTicket(tx, locked.id, {
      lastActivityAt,
      ...(firstResponse && {
        firstResponseAt: sentAt,
        ...slaBreachPatch({ ...locked, firstResponseAt: sentAt }),
      }),
      ...(resumed && { status: resumedStatus(locked) }),
    });
    if (firstResponse) await recordSlaOutcome(tx, locked, updated, 'response');
    if (resumed) {
      const eventId = await appendTicketEvent(tx, locked.id, 'status_changed', {
        from: 'waiting',
        to: updated.status,
        trigger: 'requester_replied',
      });
      await refreshCard(tx, updated, 'resumed', eventId);
    }
    return {
      outcome: { status: 'recorded', messageId: inserted.id, ticketId: locked.id },
      authorRole,
      firstResponse,
      resumed,
    } satisfies RecordMessageResult;
  });
}

/** Bot callback for an edited thread message. The first recorded text is kept for staff. */
export async function recordMessageEdit(
  ctx: ServiceContext,
  input: z.input<typeof recordMessageEditSchema>,
): Promise<RecordOutcome> {
  await requireSystemActor(ctx, 'tickets.recordMessageEdit');
  const data = parseInput(recordMessageEditSchema, input);
  const found = await findByDiscordMessage(ctx, data.discordMessageId);
  if (!found) return { status: 'ignored', reason: 'unknown_message' };
  const { message, ticketStatus } = found;
  if (ticketStatus === 'archived') return { status: 'ignored', reason: 'archived' };
  if (message.deletedAt) return { status: 'ignored', reason: 'deleted' };
  if (message.body === data.body) return { status: 'ignored', reason: 'unchanged' };
  const now = ctx.clock.now();
  await ctx.db
    .update(ticketMessages)
    .set({
      body: data.body,
      originalBody: message.originalBody ?? message.body,
      editedAt: clampTime(data.editedAt, message.createdAt, now),
    })
    .where(eq(ticketMessages.id, message.id));
  return { status: 'recorded', messageId: message.id, ticketId: message.ticketId };
}

/**
 * Bot callback for a deleted thread message. The row is kept (flagged) so
 * staff retain the record; the requester's views omit it.
 */
export async function recordMessageDelete(
  ctx: ServiceContext,
  input: z.input<typeof recordMessageDeleteSchema>,
): Promise<RecordOutcome> {
  await requireSystemActor(ctx, 'tickets.recordMessageDelete');
  const data = parseInput(recordMessageDeleteSchema, input);
  const found = await findByDiscordMessage(ctx, data.discordMessageId);
  if (!found) return { status: 'ignored', reason: 'unknown_message' };
  const { message, ticketStatus } = found;
  if (ticketStatus === 'archived') return { status: 'ignored', reason: 'archived' };
  if (message.deletedAt) return { status: 'ignored', reason: 'deleted' };
  await ctx.db
    .update(ticketMessages)
    .set({ deletedAt: clampTime(data.deletedAt, message.createdAt, ctx.clock.now()) })
    .where(and(eq(ticketMessages.id, message.id), isNull(ticketMessages.deletedAt)));
  return { status: 'recorded', messageId: message.id, ticketId: message.ticketId };
}

/**
 * Staff-only note. Never posted to the thread, never shown to the requester,
 * and it does not touch lastActivityAt (which the requester can see).
 */
export async function addInternalNote(
  ctx: ServiceContext,
  input: z.input<typeof internalNoteSchema>,
): Promise<{ messageId: string }> {
  const data = parseInput(internalNoteSchema, input);
  await authorize(ctx, 'canHandleTickets', { type: 'ticket', id: data.ticketId });
  const actor = requireUser(ctx);
  return ticketTransaction(ctx, async (tx) => {
    const ticket = await loadTicket(tx, data.ticketId);
    requireHandler(tx, ticket, 'any');
    if (ticket.status === 'archived') {
      throw new InvalidStateError('Archived tickets are read-only.');
    }
    const [note] = await tx.db
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        authorUserId: actor.userId,
        authorRole: 'handler',
        body: data.body,
        isInternal: true,
        createdAt: tx.clock.now(),
      })
      .returning({ id: ticketMessages.id });
    const messageId = note!.id;
    await appendTicketEvent(tx, ticket.id, 'note_added', { messageId });
    await recordAudit(tx, {
      action: 'ticket.internal_note_added',
      targetType: 'ticket',
      targetId: ticket.id,
      context: { number: ticket.number, messageId, length: data.body.length },
    });
    return { messageId };
  });
}
