import { eq } from 'drizzle-orm';
import { tickets, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { getSettings } from '../settings/settings.service';
import type { TicketRecord } from './access';
import { threadName } from './copy';
import {
  type CardChange,
  CLOSE_THREAD_JOB,
  enqueueTicketDiscordJob,
  OPEN_THREAD_JOB,
  REOPEN_THREAD_JOB,
  UPDATE_CARD_JOB,
} from './discord-jobs';

/**
 * Discord side effects of ticket state changes. All run inside the caller's
 * transaction (transactional outbox); dedupe keys anchor on the ticket event
 * that caused them, so each fact produces at most one job.
 */

/** Persist a ticket patch (updatedAt from the injected clock). */
export async function saveTicket(
  ctx: ServiceContext,
  ticketId: string,
  patch: Partial<typeof tickets.$inferInsert>,
): Promise<TicketRecord> {
  const [row] = await ctx.db
    .update(tickets)
    .set({ ...patch, updatedAt: ctx.clock.now() })
    .where(eq(tickets.id, ticketId))
    .returning();
  return row!;
}

/**
 * Refresh the thread card. Skipped while the thread does not exist yet:
 * markThreadCreated always schedules a refresh once it does.
 */
export async function refreshCard(
  ctx: ServiceContext,
  ticket: TicketRecord,
  change: CardChange,
  anchor: string,
  note: string | null = null,
): Promise<void> {
  if (!ticket.discordThreadId) return;
  await enqueueTicketDiscordJob(
    ctx,
    UPDATE_CARD_JOB,
    { ticketId: ticket.id, change, note, assigneeUserId: ticket.assigneeUserId },
    `ticket-card:${ticket.id}:${anchor}`,
  );
}

/**
 * Provision the private thread. Returns false when no ticket channel is
 * configured (the ticket stays usable from the dashboard).
 */
export async function scheduleOpenThread(
  ctx: ServiceContext,
  ticket: TicketRecord,
): Promise<boolean> {
  const parentChannelId =
    ticket.discordChannelId ?? (await getSettings(ctx, 'channels')).tickets ?? null;
  if (!parentChannelId) {
    ctx.logger.warn({ ticketId: ticket.id }, 'no ticket channel configured; thread not scheduled');
    return false;
  }
  const [opener] = await ctx.db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.id, ticket.openerUserId));
  if (!opener) return false;
  await enqueueTicketDiscordJob(
    ctx,
    OPEN_THREAD_JOB,
    {
      ticketId: ticket.id,
      parentChannelId,
      openerDiscordId: opener.discordId,
      threadName: threadName(ticket.number, ticket.subject),
    },
    `ticket-thread-open:${ticket.id}`,
  );
  return true;
}

export async function scheduleCloseThread(
  ctx: ServiceContext,
  ticket: TicketRecord,
  anchor: string,
): Promise<boolean> {
  if (!ticket.discordThreadId) return false;
  const channels = await getSettings(ctx, 'channels');
  await enqueueTicketDiscordJob(
    ctx,
    CLOSE_THREAD_JOB,
    {
      ticketId: ticket.id,
      threadId: ticket.discordThreadId,
      archiveChannelId: channels.ticketArchive ?? null,
    },
    `ticket-thread-close:${ticket.id}:${anchor}`,
  );
  return true;
}

/** Reopen the existing thread, or provision one if the ticket never got a thread. */
export async function scheduleReopenThread(
  ctx: ServiceContext,
  ticket: TicketRecord,
  reason: string,
  anchor: string,
): Promise<void> {
  if (!ticket.discordThreadId) {
    await scheduleOpenThread(ctx, ticket);
    return;
  }
  await enqueueTicketDiscordJob(
    ctx,
    REOPEN_THREAD_JOB,
    { ticketId: ticket.id, threadId: ticket.discordThreadId, reason },
    `ticket-thread-reopen:${ticket.id}:${anchor}`,
  );
}
