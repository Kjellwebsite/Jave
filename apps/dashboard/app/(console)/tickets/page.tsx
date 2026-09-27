import type { Metadata } from 'next';
import Link from 'next/link';
import { LifeBuoy, Search } from 'lucide-react';
import { can, tickets } from '@jave/core';
import {
  Badge,
  Button,
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  Input,
  LinkTabs,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import { OpenTicketDialog } from '@/components/tickets/open-ticket-dialog';
import { QueueStats } from '@/components/tickets/queue-stats';
import { type QueueRow, QueueTable } from '@/components/tickets/queue-table';
import { type SearchParams, toQueryString } from '@/lib/search-params';
import { CATEGORY_LABELS, optionsOf, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/ticket-view';
import { formatRelative, formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { listTicketHandlers, peopleNames } from '@/server/tickets/people';
import {
  activeQuickView,
  filterQuery,
  isFiltered,
  listInputFor,
  loadQueueCounts,
  loadTicketPerformance,
  parseQueueFilters,
  QUICK_VIEWS,
  queueMode,
  type QueueFilters,
} from '@/server/tickets/queue';
import { bulkClaimAction, bulkCloseAction, bulkPriorityAction, openTicketAction } from './actions';

export const metadata: Metadata = { title: 'Tickets' };

const SEARCH_MAX_LENGTH = 64;

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  ...optionsOf(STATUS_LABELS),
  { value: 'all', label: 'Any status' },
];
const SLA_OPTIONS = [
  { value: 'missed', label: 'Target missed' },
  { value: 'ok', label: 'Not missed' },
];
const STAFF_SORTS = [
  { value: 'sla', label: 'Due first' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'activity', label: 'Last activity' },
];
const OWN_SORTS = STAFF_SORTS.filter((option) => option.value !== 'sla');

/** Filters kept when switching quick views. */
function carried(filters: QueueFilters) {
  return { q: filters.q, category: filters.category, priority: filters.priority };
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx, actor } = await requireConsoleContext();
  const params = await searchParams;
  const handler = can(ctx, 'canHandleTickets');
  const filters = parseQueueFilters(params, handler);
  const mode = queueMode(filters, handler);
  const staff = mode === 'handler';

  const result = await guarded(() => tickets.listTickets(ctx, listInputFor(filters, mode)));
  if (!result.ok) {
    return (
      <RestrictedPage eyebrow="SUPPORT & SAFETY" title="Tickets" capability="canHandleTickets" />
    );
  }
  const page = result.value;
  const [viewer, counts, performance, handlers, openerNames] = await Promise.all([
    loadViewer(ctx),
    staff ? loadQueueCounts(ctx) : null,
    staff ? loadTicketPerformance(ctx) : null,
    staff ? listTicketHandlers(ctx) : [],
    filters.opener ? peopleNames(ctx, [filters.opener]) : new Map<string, string>(),
  ]);
  const tz = viewer.timeZone;
  const now = ctx.clock.now();
  const query = filterQuery(filters, mode);
  const filtered = isFiltered(filters);
  const quickView = handler ? activeQuickView(filters, mode) : null;
  const openerName = filters.opener ? (openerNames.get(filters.opener) ?? 'Unknown member') : null;

  const rows: QueueRow[] = page.items.map((item) => ({
    id: item.id,
    reference: item.reference,
    subject: item.subject,
    status: item.status,
    priority: item.priority,
    category: item.category,
    assigneeName: item.assignee?.displayName ?? null,
    createdAt: item.createdAt,
    activityAt: item.lastActivityAt,
    activityLabel: formatRelative(item.lastActivityAt, now, tz),
    sla: item.sla
      ? {
          state: item.sla.state,
          dueAt: item.sla.dueAt,
          firstResponseMinutes: item.sla.firstResponseMinutes,
        }
      : null,
    dueLabel: item.sla?.dueAt ? formatTimestamp(item.sla.dueAt, tz) : null,
  }));

  const assigneeOptions = [
    { value: 'me', label: 'Assigned to me' },
    { value: 'none', label: 'Unassigned' },
    ...handlers
      .filter((person) => person.userId !== actor.userId)
      .map((person) => ({ value: person.userId, label: person.displayName })),
  ];

  const narrowed = filtered || filters.status !== (staff ? 'active' : 'all');
  // A member with no tickets at all gets the empty state alone: nothing to filter yet.
  const showFilters = staff || narrowed || page.total > 0;
  const empty = narrowed ? (
    <EmptyState
      compact
      title="NO MATCHES"
      description="No ticket matches these filters."
      action={
        <Link href="/tickets" className={buttonStyles({ size: 'sm' })}>
          Clear filters
        </Link>
      }
    />
  ) : staff ? (
    <EmptyState
      icon={LifeBuoy}
      title="QUEUE CLEAR"
      description="No active tickets. New tickets appear here the moment they are opened."
    />
  ) : (
    <EmptyState
      icon={LifeBuoy}
      title="NO TICKETS"
      description="When you need JAVELIN staff, open a ticket. Replies arrive in a private Discord thread."
    />
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SUPPORT & SAFETY"
        title="Tickets"
        description={
          staff
            ? 'Every support case, most urgent deadline first. Claim, triage and close here or in Discord.'
            : 'Your support cases with JAVELIN staff. Conversations happen in your private Discord thread.'
        }
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')}{' '}
            {filtered ? 'matching' : page.total === 1 ? 'ticket' : 'tickets'}
          </Mono>
        }
        actions={actor.memberId ? <OpenTicketDialog action={openTicketAction} /> : null}
      />

      {counts ? <QueueStats counts={counts} performance={performance} /> : null}

      <div className="space-y-4">
        {handler ? (
          <LinkTabs
            label="Queue views"
            linkComponent={NextLink}
            tabs={QUICK_VIEWS.map((view) => ({
              href: `/tickets${toQueryString({ ...carried(filters), ...view.params })}`,
              label: view.label,
              active: view.key === quickView,
            }))}
          />
        ) : null}

        <Card padding="none">
          {showFilters ? (
            <form
              method="get"
              action="/tickets"
              role="search"
              aria-label="Filter tickets"
              className="border-b border-line-subtle p-4"
            >
              {filters.scope ? <input type="hidden" name="scope" value={filters.scope} /> : null}
              {filters.opener ? <input type="hidden" name="opener" value={filters.opener} /> : null}
              <Toolbar
                className={
                  staff
                    ? 'grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.5fr)_repeat(6,minmax(0,1fr))_auto]'
                    : 'grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_auto]'
                }
              >
                <label className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
                  <span className="sr-only">Search tickets</span>
                  <Icon
                    icon={Search}
                    size="sm"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                  />
                  <Input
                    name="q"
                    type="search"
                    defaultValue={filters.q ?? ''}
                    placeholder="Subject"
                    maxLength={SEARCH_MAX_LENGTH}
                    className="pl-8"
                  />
                </label>
                <NativeSelect
                  name="status"
                  aria-label="Status"
                  defaultValue={filters.status}
                  options={STATUS_OPTIONS}
                />
                <NativeSelect
                  name="category"
                  aria-label="Category"
                  defaultValue={filters.category ?? ''}
                  placeholder="Category"
                  options={optionsOf(CATEGORY_LABELS)}
                />
                <NativeSelect
                  name="priority"
                  aria-label="Priority"
                  defaultValue={filters.priority ?? ''}
                  placeholder="Priority"
                  options={optionsOf(PRIORITY_LABELS)}
                />
                {staff ? (
                  <>
                    <NativeSelect
                      name="assignee"
                      aria-label="Handler"
                      defaultValue={filters.assignee ?? ''}
                      placeholder="Handler"
                      options={assigneeOptions}
                    />
                    <NativeSelect
                      name="sla"
                      aria-label="First-response target"
                      defaultValue={filters.sla ?? ''}
                      placeholder="Target"
                      options={SLA_OPTIONS}
                    />
                  </>
                ) : null}
                <NativeSelect
                  name="sort"
                  aria-label="Sort"
                  defaultValue={filters.sort}
                  options={staff ? STAFF_SORTS : OWN_SORTS}
                />
                <div className="col-span-2 flex gap-2 md:col-span-4 xl:col-span-1">
                  <Button type="submit" variant="primary" className="flex-1 xl:flex-none">
                    Apply
                  </Button>
                  {filtered ? (
                    <Link
                      href={`/tickets${toQueryString({ scope: filters.scope })}`}
                      className={buttonStyles({ variant: 'ghost' })}
                    >
                      Reset
                    </Link>
                  ) : null}
                </div>
              </Toolbar>
            </form>
          ) : null}

          {openerName ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle px-4 py-3"
              data-testid="opener-filter"
            >
              <Badge>Opened by</Badge>
              <span className="min-w-0 truncate text-small text-fg">{openerName}</span>
              <Link
                href={`/tickets${toQueryString({ ...query, opener: undefined })}`}
                className={buttonStyles({ variant: 'ghost', size: 'sm', className: 'ml-auto' })}
              >
                All requesters
              </Link>
            </div>
          ) : null}

          {showFilters ? (
            <QueueTable
              rows={rows}
              staff={staff}
              renderedAt={now}
              empty={empty}
              bulk={
                staff
                  ? { claim: bulkClaimAction, priority: bulkPriorityAction, close: bulkCloseAction }
                  : null
              }
            />
          ) : (
            empty
          )}

          {page.total > 0 ? (
            <div className="border-t border-line-subtle px-5 py-3">
              <Pagination
                offset={page.offset}
                limit={page.limit}
                total={page.total}
                linkComponent={NextLink}
                hrefForOffset={(next) =>
                  `/tickets${toQueryString({ ...query, offset: next || undefined })}`
                }
              />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
