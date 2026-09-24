import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import {
  members,
  type TicketAttachment,
  ticketEvents,
  ticketMessages,
  users,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { isActive, type TicketRecord, type TicketViewer } from './access';
import {
  AI_SUMMARY_LABEL,
  REQUESTER_VISIBLE_EVENTS,
  type TicketCategory,
  type TicketEventType,
  type TicketPriority,
  ticketReference,
  type TicketStatus,
} from './constants';
import { userSummaries, type UserSummary } from './records';
import { isOverdue, minutesBetween, slaState, type SlaState } from './sla';

export type TicketAuthorRole = (typeof ticketMessages.$inferSelect)['authorRole'];

export interface TicketSla {
  dueAt: Date | null;
  firstResponseAt: Date | null;
  /** Minutes from opening to the first handler response. */
  firstResponseMinutes: number | null;
  breachedAt: Date | null;
  state: SlaState;
  /** Past due and unanswered, even before the next sweep records the breach. */
  overdue: boolean;
}

export interface TicketAiSummary {
  text: string;
  generatedAt: Date;
  /** Always shown next to the text: the summary is machine-written and unverified. */
  label: typeof AI_SUMMARY_LABEL;
}

export interface TicketSummary {
  id: string;
  number: number;
  reference: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  createdAt: Date;
  lastActivityAt: Date;
  closedAt: Date | null;
  assignee: UserSummary | null;
  /** Staff-only; null in the requester view. */
  sla: TicketSla | null;
}

export interface TicketMessageView {
  id: string;
  authorUserId: string | null;
  authorName: string | null;
  authorRole: TicketAuthorRole;
  body: string;
  attachments: TicketAttachment[];
  isInternal: boolean;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  /** Staff-only: the text as first recorded, when the message was edited. */
  originalBody: string | null;
}

export interface TicketEventView {
  id: string;
  type: TicketEventType;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface TicketView extends TicketSummary {
  viewer: TicketViewer;
  opener: UserSummary | null;
  closedBy: UserSummary | null;
  closeReason: string | null;
  reopenCount: number;
  archivedAt: Date | null;
  thread: { channelId: string | null; threadId: string } | null;
  /** Staff-only; null in the requester view. */
  aiSummary: TicketAiSummary | null;
  messages: TicketMessageView[];
  /** True when older messages were left out (see VIEW_MESSAGE_LIMIT). */
  messagesTruncated: boolean;
  events: TicketEventView[];
}

export function slaOf(ticket: TicketRecord, now: Date): TicketSla {
  return {
    dueAt: ticket.slaFirstResponseDueAt,
    firstResponseAt: ticket.firstResponseAt,
    firstResponseMinutes: ticket.firstResponseAt
      ? minutesBetween(ticket.createdAt, ticket.firstResponseAt)
      : null,
    breachedAt: ticket.slaBreachedAt,
    state: slaState(ticket),
    overdue: isActive(ticket) && isOverdue(ticket, now),
  };
}

export function aiSummaryOf(ticket: TicketRecord): TicketAiSummary | null {
  if (!ticket.aiSummary || !ticket.aiSummaryAt) return null;
  return { text: ticket.aiSummary, generatedAt: ticket.aiSummaryAt, label: AI_SUMMARY_LABEL };
}

export function toSummary(
  ticket: TicketRecord,
  viewer: TicketViewer,
  people: Map<string, UserSummary>,
  now: Date,
): TicketSummary {
  return {
    id: ticket.id,
    number: ticket.number,
    reference: ticketReference(ticket.number),
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    createdAt: ticket.createdAt,
    lastActivityAt: ticket.lastActivityAt,
    closedAt: ticket.closedAt,
    assignee: ticket.assigneeUserId ? (people.get(ticket.assigneeUserId) ?? null) : null,
    sla: viewer === 'handler' ? slaOf(ticket, now) : null,
  };
}

export interface MessageQuery {
  includeInternal: boolean;
  includeDeleted: boolean;
  limit: number;
}

/** Member display name, else Discord display name, else username. */
const personName = sql<
  string | null
>`coalesce(${members.displayName}, ${users.displayName}, ${users.username})`;

/** Most recent `limit` messages, returned oldest first. */
export async function loadMessages(
  ctx: ServiceContext,
  ticketId: string,
  query: MessageQuery,
): Promise<{ messages: TicketMessageView[]; truncated: boolean }> {
  const filters: SQL[] = [eq(ticketMessages.ticketId, ticketId)];
  if (!query.includeInternal) filters.push(eq(ticketMessages.isInternal, false));
  if (!query.includeDeleted) filters.push(isNull(ticketMessages.deletedAt));
  const rows = await ctx.db
    .select({
      id: ticketMessages.id,
      authorUserId: ticketMessages.authorUserId,
      authorName: personName,
      authorRole: ticketMessages.authorRole,
      body: ticketMessages.body,
      originalBody: ticketMessages.originalBody,
      attachments: ticketMessages.attachments,
      isInternal: ticketMessages.isInternal,
      createdAt: ticketMessages.createdAt,
      editedAt: ticketMessages.editedAt,
      deletedAt: ticketMessages.deletedAt,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .leftJoin(members, eq(members.userId, users.id))
    .where(and(...filters))
    .orderBy(desc(ticketMessages.createdAt), desc(ticketMessages.seq))
    .limit(query.limit + 1);
  const truncated = rows.length > query.limit;
  const messages = rows.slice(0, query.limit).reverse();
  return { messages, truncated };
}

export async function loadEvents(
  ctx: ServiceContext,
  ticketId: string,
  viewer: TicketViewer | 'full',
): Promise<TicketEventView[]> {
  const filters: SQL[] = [eq(ticketEvents.ticketId, ticketId)];
  if (viewer === 'requester')
    filters.push(inArray(ticketEvents.type, [...REQUESTER_VISIBLE_EVENTS]));
  return ctx.db
    .select({
      id: ticketEvents.id,
      type: ticketEvents.type,
      actorName: personName,
      data: ticketEvents.data,
      createdAt: ticketEvents.createdAt,
    })
    .from(ticketEvents)
    .leftJoin(users, eq(users.id, ticketEvents.actorUserId))
    .leftJoin(members, eq(members.userId, users.id))
    .where(and(...filters))
    .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.seq));
}

/** The full view of one ticket for `viewer`. Requesters never see staff-only data. */
export async function buildTicketView(
  ctx: ServiceContext,
  ticket: TicketRecord,
  viewer: TicketViewer,
  messageLimit: number,
): Promise<TicketView> {
  const staff = viewer === 'handler';
  const [people, { messages, truncated }, events] = await Promise.all([
    userSummaries(ctx, [ticket.openerUserId, ticket.assigneeUserId, ticket.closedByUserId]),
    loadMessages(ctx, ticket.id, {
      includeInternal: staff,
      includeDeleted: staff,
      limit: messageLimit,
    }),
    loadEvents(ctx, ticket.id, viewer),
  ]);
  return {
    ...toSummary(ticket, viewer, people, ctx.clock.now()),
    viewer,
    opener: people.get(ticket.openerUserId) ?? null,
    closedBy: ticket.closedByUserId ? (people.get(ticket.closedByUserId) ?? null) : null,
    closeReason: ticket.closeReason,
    reopenCount: ticket.reopenCount,
    archivedAt: ticket.archivedAt,
    thread: ticket.discordThreadId
      ? { channelId: ticket.discordChannelId, threadId: ticket.discordThreadId }
      : null,
    aiSummary: staff ? aiSummaryOf(ticket) : null,
    messages: staff ? messages : messages.map((m) => ({ ...m, originalBody: null })),
    messagesTruncated: truncated,
    events,
  };
}

/** Summary of one ticket for the actor who just changed it. */
export async function ticketSummaryFor(
  ctx: ServiceContext,
  ticket: TicketRecord,
  viewer: TicketViewer,
): Promise<TicketSummary> {
  const people = await userSummaries(ctx, [ticket.assigneeUserId]);
  return toSummary(ticket, viewer, people, ctx.clock.now());
}
