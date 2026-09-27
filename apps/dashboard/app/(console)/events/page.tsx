import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, Plus } from 'lucide-react';
import { calendar, can } from '@jave/core';
import {
  Badge,
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  LinkTabs,
  Mono,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { MemberOnlyPage } from '@/components/events/member-only-page';
import { NextLink } from '@/components/next-link';
import {
  capacityLabel,
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  RSVP_LABELS,
  RSVP_TONE,
} from '@/lib/event-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Events' };

const PAGE_SIZE = 20;
const SCOPES = ['upcoming', 'past'] as const;
type Scope = (typeof SCOPES)[number];
const SCOPE_LABELS: Record<Scope, string> = { upcoming: 'Upcoming', past: 'Past' };

function EventRow({ event, timeZone }: { event: calendar.EventView; timeZone: string }) {
  const when = formatTimestamp(event.startsAt, timeZone);
  return (
    <TableRow>
      <TableCell>
        <Link href={`/events/${event.id}`} className="row-link flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-medium text-fg">{event.title}</span>
            <Badge className="hidden sm:inline-flex">{EVENT_KIND_LABELS[event.kind]}</Badge>
          </span>
          <Mono dim className="text-[12px] md:hidden">
            {when}
          </Mono>
        </Link>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Mono>{when}</Mono>
      </TableCell>
      <TableCell>
        <StatusBadge
          quiet={event.status === 'scheduled' || event.status === 'completed'}
          live={event.status === 'live'}
          tone={EVENT_STATUS_TONE[event.status]}
          label={EVENT_STATUS_LABELS[event.status].toUpperCase()}
        />
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Mono dim>{capacityLabel(event)}</Mono>
      </TableCell>
      <TableCell className="hidden text-right sm:table-cell">
        {event.myRsvp ? (
          <StatusBadge
            quiet
            tone={RSVP_TONE[event.myRsvp.status]}
            label={RSVP_LABELS[event.myRsvp.status].toUpperCase()}
          />
        ) : (
          <Mono dim aria-label="no response">
            —
          </Mono>
        )}
      </TableCell>
    </TableRow>
  );
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const requested = firstParam(params.scope);
  const scope: Scope = SCOPES.find((candidate) => candidate === requested) ?? 'upcoming';
  const offset = offsetParam(params.offset);
  const result = await guarded(() => calendar.listEvents(ctx, { scope, limit: PAGE_SIZE, offset }));
  if (!result.ok) return <MemberOnlyPage eyebrow="OPERATIONS" title="Events" />;
  const page = result.value;
  const viewer = await loadViewer(ctx);
  const staff = can(ctx, 'canManageEvents');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Events"
        description="Meetups, workshops, talks and tournaments. RSVPs and check-in stay in sync with the Discord announcement."
        meta={
          <Mono dim>
            {page.total} {scope}
          </Mono>
        }
        actions={
          staff ? (
            <Link href="/events/new" className={buttonStyles({ variant: 'primary' })}>
              <Icon icon={Plus} size="md" />
              New event
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        <LinkTabs
          label="Event scope"
          linkComponent={NextLink}
          tabs={SCOPES.map((candidate) => ({
            href: `/events${toQueryString({ scope: candidate === 'upcoming' ? undefined : candidate })}`,
            label: SCOPE_LABELS[candidate],
            active: candidate === scope,
          }))}
        />

        <Card padding="none">
          {page.items.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title={scope === 'upcoming' ? 'NO UPCOMING EVENTS' : 'NO PAST EVENTS'}
              description={
                scope === 'upcoming'
                  ? 'Scheduled events appear here and in the Discord events channel.'
                  : 'Completed and cancelled events are kept here.'
              }
              action={
                staff && scope === 'upcoming' ? (
                  <Link href="/events/new" className={buttonStyles({ size: 'sm' })}>
                    Schedule an event
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <Table caption={`${SCOPE_LABELS[scope]} events`}>
              <TableHead>
                <tr>
                  <TableHeaderCell>Event</TableHeaderCell>
                  <TableHeaderCell className="hidden md:table-cell">Starts</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="hidden lg:table-cell">Attendance</TableHeaderCell>
                  <TableHeaderCell className="hidden text-right sm:table-cell">You</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {page.items.map((event) => (
                  <EventRow key={event.id} event={event} timeZone={viewer.timeZone} />
                ))}
              </TableBody>
            </Table>
          )}
          {page.total > page.limit ? (
            <div className="border-t border-line-subtle px-5 py-3">
              <Pagination
                offset={page.offset}
                limit={page.limit}
                total={page.total}
                linkComponent={NextLink}
                hrefForOffset={(next) =>
                  `/events${toQueryString({
                    scope: scope === 'upcoming' ? undefined : scope,
                    offset: next || undefined,
                  })}`
                }
              />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
