import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { members, ticketEvents, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { actorUserId } from '../permissions/actor';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import type { TicketRecord } from './access';
import { TICKET_DASHBOARD_PATH, type TicketEventType } from './constants';

export interface UserSummary {
  userId: string;
  discordId: string;
  displayName: string;
}

/** Append to the ticket's own timeline. Returns the event id (used as a dedupe anchor). */
export async function appendTicketEvent(
  ctx: ServiceContext,
  ticketId: string,
  type: TicketEventType,
  data: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await ctx.db
    .insert(ticketEvents)
    .values({
      ticketId,
      type,
      actorUserId: actorUserId(ctx.actor),
      data,
      createdAt: ctx.clock.now(),
    })
    .returning({ id: ticketEvents.id });
  return row!.id;
}

export async function memberIdForUser(ctx: ServiceContext, userId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), isNull(members.deletedAt)));
  return row?.id ?? null;
}

/** Display identity for a set of users (member display name, else Discord name). */
export async function userSummaries(
  ctx: ServiceContext,
  userIds: readonly (string | null | undefined)[],
): Promise<Map<string, UserSummary>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      userId: users.id,
      discordId: users.discordId,
      displayName: sql<string>`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`,
    })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.userId, row]));
}

export async function userSummary(
  ctx: ServiceContext,
  userId: string,
): Promise<UserSummary | null> {
  return (await userSummaries(ctx, [userId])).get(userId) ?? null;
}

/** Dashboard link for a ticket, when the deployment has a public URL. */
export function ticketUrl(ctx: ServiceContext, ticketId: string): string | undefined {
  const base = ctx.config.publicUrl?.replace(/\/+$/, '');
  return base ? `${base}${TICKET_DASHBOARD_PATH}/${ticketId}` : undefined;
}

export interface TicketNotice {
  title: string;
  body: string;
}

/**
 * 'ticket.updated' to one person, deduplicated on the ticket event that
 * caused it. Never notifies the actor about their own action.
 */
export async function notifyTicketUpdate(
  ctx: ServiceContext,
  ticket: TicketRecord,
  recipientUserId: string | null,
  notice: TicketNotice,
  eventId: string,
): Promise<void> {
  if (!recipientUserId || recipientUserId === actorUserId(ctx.actor)) return;
  await notify(ctx, {
    recipientUserId,
    type: 'ticket.updated',
    title: notice.title,
    body: notice.body,
    url: ticketUrl(ctx, ticket.id),
    data: { ticketId: ticket.id, number: ticket.number },
    dedupeKey: `ticket:${ticket.id}:event:${eventId}`,
  });
}

/**
 * 'ticket.attention' (staff-only type) to the assignee when there is one,
 * otherwise to every ticket handler. The opener and the actor are excluded.
 */
export async function alertTicketStaff(
  ctx: ServiceContext,
  ticket: TicketRecord,
  notice: TicketNotice,
  dedupeKey: string,
): Promise<number> {
  const actor = actorUserId(ctx.actor);
  const input = {
    type: 'ticket.attention' as const,
    title: notice.title,
    body: notice.body,
    url: ticketUrl(ctx, ticket.id),
    data: { ticketId: ticket.id, number: ticket.number },
  };
  if (ticket.assigneeUserId) {
    if (ticket.assigneeUserId === actor) return 0;
    const id = await notify(ctx, {
      ...input,
      recipientUserId: ticket.assigneeUserId,
      dedupeKey: `${dedupeKey}:${ticket.assigneeUserId}`,
    });
    return id ? 1 : 0;
  }
  return notifyCapabilityHolders(
    ctx,
    'canHandleTickets',
    { ...input, dedupeKey },
    { excludeUserIds: [ticket.openerUserId, ...(actor ? [actor] : [])] },
  );
}
