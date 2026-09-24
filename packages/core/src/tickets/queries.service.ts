import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';
import { tickets } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { DAY } from '../kernel/clock';
import { ValidationError } from '../kernel/errors';
import { type Page } from '../kernel/pagination';
import { parseInput } from '../kernel/validation';
import { authorize, can, requireUser } from '../permissions/authorize';
import { auditingDenials, loadTicket, requireViewer, type TicketViewer } from './access';
import {
  ACTIVE_STATUSES,
  STATS_DEFAULT_WINDOW_DAYS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketPriority,
  VIEW_MESSAGE_LIMIT,
} from './constants';
import { userSummaries } from './records';
import {
  type ListTicketsInput,
  listTicketsSchema,
  ticketRefSchema,
  ticketStatsSchema,
} from './schemas';
import { roundToTenth } from './sla';
import { buildTicketView, type TicketSummary, type TicketView, toSummary } from './views';

/**
 * One ticket. The opener receives the requester view (no internal notes, no
 * staff-only events, no SLA or AI data); ticket handlers receive everything.
 */
export async function getTicket(
  ctx: ServiceContext,
  input: z.input<typeof ticketRefSchema>,
): Promise<TicketView> {
  const data = parseInput(ticketRefSchema, input);
  const ticket = await loadTicket(ctx, data.ticketId);
  const viewer = await auditingDenials(ctx, async () => requireViewer(ctx, ticket));
  return buildTicketView(ctx, ticket, viewer, VIEW_MESSAGE_LIMIT);
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}

const NON_ARCHIVED = TICKET_STATUSES.filter((s) => s !== 'archived');

/**
 * Ticket list. Handlers see every ticket and may filter by assignee, SLA
 * breach and opener; everyone else (and handlers with `mine: true`) sees only
 * the tickets they opened. Archived tickets appear only when asked for.
 */
export async function listTickets(
  ctx: ServiceContext,
  input: ListTicketsInput = {},
): Promise<Page<TicketSummary>> {
  const q = parseInput(listTicketsSchema, input);
  const userId = ctx.actor.kind === 'system' ? null : requireUser(ctx).userId;
  const viewer: TicketViewer =
    can(ctx, 'canHandleTickets') && !(q.mine && userId) ? 'handler' : 'requester';

  const filters: SQL[] = [inArray(tickets.status, [...(q.status ?? NON_ARCHIVED)])];
  if (viewer === 'requester' && userId) filters.push(eq(tickets.openerUserId, userId));
  if (q.category) filters.push(eq(tickets.category, q.category));
  if (q.priority) filters.push(eq(tickets.priority, q.priority));
  if (q.search) filters.push(ilike(tickets.subject, `%${escapeLike(q.search)}%`));
  if (viewer === 'handler') {
    if (q.assignee === 'none') filters.push(isNull(tickets.assigneeUserId));
    else if (q.assignee === 'me' && userId) filters.push(eq(tickets.assigneeUserId, userId));
    else if (q.assignee && q.assignee !== 'me')
      filters.push(eq(tickets.assigneeUserId, q.assignee));
    if (q.breached !== undefined) {
      filters.push(q.breached ? isNotNull(tickets.slaBreachedAt) : isNull(tickets.slaBreachedAt));
    }
    if (q.openerUserId) filters.push(eq(tickets.openerUserId, q.openerUserId));
  }
  const sort = viewer === 'requester' && q.sort === 'sla' ? 'newest' : q.sort;
  const order = {
    newest: [desc(tickets.createdAt), desc(tickets.number)],
    oldest: [asc(tickets.createdAt), asc(tickets.number)],
    activity: [desc(tickets.lastActivityAt), desc(tickets.number)],
    sla: [sql`${tickets.slaFirstResponseDueAt} asc nulls last`, asc(tickets.number)],
  }[sort];
  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(tickets)
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(tickets)
      .where(where),
  ]);
  const people = await userSummaries(
    ctx,
    rows.map((r) => r.assigneeUserId),
  );
  const now = ctx.clock.now();
  return {
    items: rows.map((row) => toSummary(row, viewer, people, now)),
    total: total?.value ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export interface TicketStats {
  window: { since: Date; until: Date };
  /** Current backlog (not windowed). */
  active: { total: number; open: number; claimed: number; waiting: number; unassigned: number };
  /** Tickets opened inside the window. */
  opened: number;
  /** Tickets closed inside the window. */
  closed: number;
  firstResponse: {
    /** Window tickets that received a first response. */
    responded: number;
    medianMinutes: number | null;
  };
  sla: {
    /** Window tickets whose SLA outcome is known (answered, or breached). */
    decided: number;
    breached: number;
    /** breached / decided; null when nothing is decided yet. */
    breachRate: number | null;
  };
  byCategory: Record<TicketCategory, number>;
  byPriority: Record<TicketPriority, number>;
}

function zeroes<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

const MINUTES_PER_SECOND = 1 / 60;
const RATE_PRECISION = 10_000;

/**
 * Ticket analytics: backlog, median time to first response and SLA breach
 * rate over a window (default: the last 30 days). canViewAnalytics or
 * canManageTickets.
 */
export async function getTicketStats(
  ctx: ServiceContext,
  input: z.input<typeof ticketStatsSchema> = {},
): Promise<TicketStats> {
  const q = parseInput(ticketStatsSchema, input);
  if (!can(ctx, 'canViewAnalytics')) {
    await authorize(ctx, 'canManageTickets', { type: 'ticket_stats' });
  }
  // The window is half-open [since, until). By default it ends just after now,
  // so tickets opened this very millisecond are counted.
  const until = q.until ?? new Date(ctx.clock.now().getTime() + 1);
  const since = q.since ?? new Date(until.getTime() - STATS_DEFAULT_WINDOW_DAYS * DAY);
  if (since.getTime() >= until.getTime()) {
    throw new ValidationError('since: must be before until');
  }
  const inWindow = and(gte(tickets.createdAt, since), lt(tickets.createdAt, until));
  const responseSeconds = sql`extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt}))`;

  const [[active], [window], [closed], categories, priorities] = await Promise.all([
    ctx.db
      .select({
        open: sql<number>`count(*) filter (where ${tickets.status} = 'open')::int`,
        claimed: sql<number>`count(*) filter (where ${tickets.status} = 'claimed')::int`,
        waiting: sql<number>`count(*) filter (where ${tickets.status} = 'waiting')::int`,
        unassigned: sql<number>`count(*) filter (where ${tickets.assigneeUserId} is null)::int`,
      })
      .from(tickets)
      .where(inArray(tickets.status, [...ACTIVE_STATUSES])),
    ctx.db
      .select({
        opened: sql<number>`count(*)::int`,
        responded: sql<number>`count(${tickets.firstResponseAt})::int`,
        medianSeconds: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${responseSeconds}) filter (where ${tickets.firstResponseAt} is not null)`,
        breached: sql<number>`count(${tickets.slaBreachedAt})::int`,
        decided: sql<number>`count(*) filter (where ${tickets.firstResponseAt} is not null or ${tickets.slaBreachedAt} is not null)::int`,
      })
      .from(tickets)
      .where(inWindow),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(gte(tickets.closedAt, since), lt(tickets.closedAt, until))),
    ctx.db
      .select({ key: tickets.category, value: sql<number>`count(*)::int` })
      .from(tickets)
      .where(inWindow)
      .groupBy(tickets.category),
    ctx.db
      .select({ key: tickets.priority, value: sql<number>`count(*)::int` })
      .from(tickets)
      .where(inWindow)
      .groupBy(tickets.priority),
  ]);

  const byCategory = zeroes(TICKET_CATEGORIES);
  for (const row of categories) byCategory[row.key] = row.value;
  const byPriority = zeroes(TICKET_PRIORITIES);
  for (const row of priorities) byPriority[row.key] = row.value;
  const decided = window?.decided ?? 0;
  const breached = window?.breached ?? 0;
  const medianSeconds = window?.medianSeconds ?? null;
  const open = active?.open ?? 0;
  const claimedCount = active?.claimed ?? 0;
  const waiting = active?.waiting ?? 0;
  return {
    window: { since, until },
    active: {
      total: open + claimedCount + waiting,
      open,
      claimed: claimedCount,
      waiting,
      unassigned: active?.unassigned ?? 0,
    },
    opened: window?.opened ?? 0,
    closed: closed?.value ?? 0,
    firstResponse: {
      responded: window?.responded ?? 0,
      medianMinutes:
        medianSeconds === null ? null : roundToTenth(Number(medianSeconds) * MINUTES_PER_SECOND),
    },
    sla: {
      decided,
      breached,
      breachRate:
        decided === 0 ? null : Math.round((breached / decided) * RATE_PRECISION) / RATE_PRECISION,
    },
    byCategory,
    byPriority,
  };
}
