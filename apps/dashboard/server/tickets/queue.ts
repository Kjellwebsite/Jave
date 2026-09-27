import 'server-only';
import { z } from 'zod';
import { can, isUuid, type ServiceContext, tickets } from '@jave/core';
import { firstParam, offsetParam, type SearchParams } from '@/lib/search-params';
import { BULK_LIMIT } from '@/lib/ticket-view';

/** Rows per queue page: bulk actions work on one page at a time. */
export const QUEUE_PAGE_SIZE = BULK_LIMIT;

export const STATUS_FILTERS = [
  'active',
  'open',
  'claimed',
  'waiting',
  'closed',
  'archived',
  'all',
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SLA_FILTERS = ['missed', 'ok'] as const;
export type SlaFilter = (typeof SLA_FILTERS)[number];

export const SORTS = ['sla', 'newest', 'oldest', 'activity'] as const;
export type QueueSort = (typeof SORTS)[number];

/** `own`: a handler's view of the tickets they opened themselves (requester view). */
export const SCOPES = ['own'] as const;

export interface QueueFilters {
  q?: string;
  status: StatusFilter;
  category?: tickets.TicketCategory;
  priority?: tickets.TicketPriority;
  /** Handlers only: 'me', 'none' or a user id. */
  assignee?: string;
  /** Handlers only. */
  sla?: SlaFilter;
  sort: QueueSort;
  scope?: 'own';
  offset: number;
}

/** Whether the list is the staff queue (handler view) or the actor's own tickets. */
export type QueueMode = 'handler' | 'requester';

const ACTIVE = [...tickets.ACTIVE_STATUSES];
const EVERY_STATUS = [...tickets.TICKET_STATUSES];

const filterSchema = z.object({
  q: tickets.listTicketsSchema.shape.search.catch(undefined),
  status: z.enum(STATUS_FILTERS).optional().catch(undefined),
  category: tickets.listTicketsSchema.shape.category.catch(undefined),
  priority: tickets.listTicketsSchema.shape.priority.catch(undefined),
  assignee: z
    .string()
    .refine((value) => value === 'me' || value === 'none' || isUuid(value))
    .optional()
    .catch(undefined),
  sla: z.enum(SLA_FILTERS).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  scope: z.enum(SCOPES).optional().catch(undefined),
});

/**
 * Query string → validated filters. Malformed values are dropped (never an
 * error page). Handler-only filters are dropped for everyone else; core
 * scopes the list again regardless.
 */
export function parseQueueFilters(params: SearchParams, handler: boolean): QueueFilters {
  const raw = filterSchema.parse({
    q: firstParam(params.q)?.trim() || undefined,
    status: firstParam(params.status) || undefined,
    category: firstParam(params.category) || undefined,
    priority: firstParam(params.priority) || undefined,
    assignee: firstParam(params.assignee) || undefined,
    sla: firstParam(params.sla) || undefined,
    sort: firstParam(params.sort) || undefined,
    scope: firstParam(params.scope) || undefined,
  });
  const staffQueue = handler && raw.scope !== 'own';
  const sort = raw.sort ?? (staffQueue ? 'sla' : 'activity');
  return {
    q: raw.q,
    status: raw.status ?? (staffQueue ? 'active' : 'all'),
    category: raw.category,
    priority: raw.priority,
    assignee: staffQueue ? raw.assignee : undefined,
    sla: staffQueue ? raw.sla : undefined,
    sort: !staffQueue && sort === 'sla' ? 'activity' : sort,
    scope: handler ? raw.scope : undefined,
    offset: offsetParam(params.offset),
  };
}

export function queueMode(filters: QueueFilters, handler: boolean): QueueMode {
  return handler && filters.scope !== 'own' ? 'handler' : 'requester';
}

function statusesFor(filter: StatusFilter): tickets.TicketStatus[] {
  if (filter === 'active') return ACTIVE;
  if (filter === 'all') return EVERY_STATUS;
  return [filter];
}

/** The core listTickets input for these filters. */
export function listInputFor(filters: QueueFilters, mode: QueueMode): tickets.ListTicketsInput {
  return {
    mine: mode === 'requester',
    status: statusesFor(filters.status),
    category: filters.category,
    priority: filters.priority,
    search: filters.q,
    assignee: mode === 'handler' ? filters.assignee : undefined,
    breached: mode === 'handler' && filters.sla ? filters.sla === 'missed' : undefined,
    sort: filters.sort,
    limit: QUEUE_PAGE_SIZE,
    offset: filters.offset,
  };
}

/** Query-string entries for these filters, defaults omitted. */
export function filterQuery(
  filters: QueueFilters,
  mode: QueueMode,
): Record<string, string | undefined> {
  const staffQueue = mode === 'handler';
  const defaultStatus: StatusFilter = staffQueue ? 'active' : 'all';
  const defaultSort: QueueSort = staffQueue ? 'sla' : 'activity';
  return {
    q: filters.q,
    status: filters.status === defaultStatus ? undefined : filters.status,
    category: filters.category,
    priority: filters.priority,
    assignee: filters.assignee,
    sla: filters.sla,
    sort: filters.sort === defaultSort ? undefined : filters.sort,
    scope: filters.scope,
  };
}

export function isFiltered(filters: QueueFilters): boolean {
  return Boolean(
    filters.q || filters.category || filters.priority || filters.assignee || filters.sla,
  );
}

// ─── Quick views ─────────────────────────────────────────────────────────────

export interface QuickView {
  key: string;
  label: string;
  params: { status?: StatusFilter; assignee?: string; sla?: SlaFilter; scope?: 'own' };
}

/** Triage shortcuts for handlers; each keeps the category, priority and search filters. */
export const QUICK_VIEWS: readonly QuickView[] = [
  { key: 'active', label: 'Active', params: {} },
  { key: 'unassigned', label: 'Unassigned', params: { assignee: 'none' } },
  { key: 'mine', label: 'Assigned to me', params: { assignee: 'me' } },
  { key: 'missed', label: 'SLA missed', params: { sla: 'missed' } },
  { key: 'waiting', label: 'Waiting', params: { status: 'waiting' } },
  { key: 'closed', label: 'Closed', params: { status: 'closed' } },
  { key: 'own', label: 'Opened by me', params: { scope: 'own' } },
];

/** The quick view whose defining parameters equal the current filters, if any. */
export function activeQuickView(filters: QueueFilters, mode: QueueMode): string | null {
  const current = filterQuery(filters, mode);
  const match = QUICK_VIEWS.find(
    (view) =>
      (view.params.status ?? undefined) === current.status &&
      (view.params.assignee ?? undefined) === current.assignee &&
      (view.params.sla ?? undefined) === current.sla &&
      (view.params.scope ?? undefined) === current.scope,
  );
  return match?.key ?? null;
}

// ─── Readouts ────────────────────────────────────────────────────────────────

export interface QueueCounts {
  active: number;
  unassigned: number;
  assignedToMe: number;
  missed: number;
}

/** Live queue counts for the stat strip. Handlers only (null otherwise). */
export async function loadQueueCounts(ctx: ServiceContext): Promise<QueueCounts | null> {
  if (!can(ctx, 'canHandleTickets')) return null;
  const count = async (input: tickets.ListTicketsInput) =>
    (await tickets.listTickets(ctx, { status: ACTIVE, limit: 1, ...input })).total;
  const [active, unassigned, assignedToMe, missed] = await Promise.all([
    count({}),
    count({ assignee: 'none' }),
    count({ assignee: 'me' }),
    count({ breached: true }),
  ]);
  return { active, unassigned, assignedToMe, missed };
}

/** 30-day performance readouts for those who may see ticket analytics (null otherwise). */
export async function loadTicketPerformance(
  ctx: ServiceContext,
): Promise<tickets.TicketStats | null> {
  if (!can(ctx, 'canViewAnalytics') && !can(ctx, 'canManageTickets')) return null;
  return tickets.getTicketStats(ctx);
}
