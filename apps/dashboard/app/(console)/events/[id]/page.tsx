import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { calendar, can, isUuid } from '@jave/core';
import { Card, LinkTabs } from '@jave/ui';
import { AttendanceTab } from '@/components/events/attendance-tab';
import { EventForm } from '@/components/events/event-form';
import { EventHeader } from '@/components/events/event-header';
import { LifecycleControls } from '@/components/events/lifecycle-controls';
import { OverviewTab } from '@/components/events/overview-tab';
import { BracketTab, TeamsTab } from '@/components/events/tournament-tabs';
import { MemberOnlyPage } from '@/components/events/member-only-page';
import { NextLink } from '@/components/next-link';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { toDatetimeLocal } from '@/lib/datetime-local';
import { requireConsoleContext } from '@/server/context';
import { EVENT_FORM_LIMITS } from '@/server/data/event-form';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import {
  cancelEventAction,
  checkInAction,
  completeEventAction,
  goLiveAction,
  issueCheckInCodeAction,
  rsvpAction,
  updateEventAction,
} from '../actions';
import {
  deleteTeamAction,
  drawTeamsAction,
  generateBracketAction,
  reportMatchAction,
} from '../tournament-actions';

export const metadata: Metadata = { title: 'Event' };

const TABS = ['overview', 'attendance', 'teams', 'bracket', 'edit'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  attendance: 'Attendance',
  teams: 'Teams',
  bracket: 'Bracket',
  edit: 'Edit',
};

function availableTabs(event: calendar.EventView, staff: boolean): Tab[] {
  return TABS.filter((tab) => {
    if (tab === 'attendance') return staff;
    if (tab === 'bracket') return event.kind === 'tournament';
    if (tab === 'edit') return staff && event.status === 'scheduled';
    return true;
  });
}

/** Which state changes to offer now; core re-checks each one. */
function lifecycle(event: calendar.EventView, now: Date) {
  const open = event.status === 'scheduled' || event.status === 'live';
  const liveFrom = event.startsAt.getTime() - calendar.GO_LIVE_EARLIEST_BEFORE_MS;
  return {
    canGoLive: event.status === 'scheduled' && now.getTime() >= liveFrom && now <= event.endsAt,
    canComplete: event.status === 'live' || (event.status === 'scheduled' && now >= event.startsAt),
    canCancel: open,
  };
}

function editValues(event: calendar.EventView, timeZone: string) {
  return {
    title: event.title,
    kind: event.kind,
    description: event.description ?? '',
    startsAt: toDatetimeLocal(event.startsAt, timeZone),
    endsAt: toDatetimeLocal(event.endsAt, timeZone),
    location: event.location?.value ?? '',
    capacity: event.capacity === null ? '' : String(event.capacity),
    rsvpClosesAt: event.rsvpClosesAt ? toDatetimeLocal(event.rsvpClosesAt, timeZone) : '',
  };
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => calendar.getEvent(ctx, { eventId: id }));
  if (!loaded.ok) {
    return <MemberOnlyPage eyebrow="OPERATIONS / EVENTS" title="Event" />;
  }
  const event = loaded.value;
  const query = await searchParams;
  const viewer = await loadViewer(ctx);
  const staff = can(ctx, 'canManageEvents');
  const now = ctx.clock.now();
  const tabs = availableTabs(event, staff);
  const requested = firstParam(query.tab);
  const tab: Tab = tabs.find((candidate) => candidate === requested) ?? 'overview';
  const tz = viewer.timeZone;
  const transitions = lifecycle(event, now);
  // Nothing left to change (completed, cancelled): no empty control strip in the header.
  const controls =
    staff && (transitions.canGoLive || transitions.canComplete || transitions.canCancel);
  // A tournament's kind is fixed once its bracket exists (core refuses the change).
  const kindLocked =
    tab === 'edit' &&
    event.kind === 'tournament' &&
    (await calendar.getBracket(ctx, { eventId: event.id })).state !== 'none';

  return (
    <div className="space-y-8">
      <EventHeader
        event={event}
        timeZone={tz}
        actions={
          controls ? (
            <LifecycleControls
              eventId={event.id}
              eventTitle={event.title}
              {...transitions}
              cancelReasonMax={calendar.CANCEL_REASON_MAX}
              goLiveAction={goLiveAction}
              completeAction={completeEventAction}
              cancelAction={cancelEventAction}
            />
          ) : null
        }
      />

      <div className="space-y-6">
        <LinkTabs
          label="Event sections"
          linkComponent={NextLink}
          tabs={tabs.map((candidate) => ({
            href: `/events/${event.id}${toQueryString({ tab: candidate === 'overview' ? undefined : candidate })}`,
            label: TAB_LABELS[candidate],
            active: candidate === tab,
          }))}
        />

        {tab === 'overview' ? (
          <OverviewTab
            event={event}
            timeZone={tz}
            now={now}
            rsvpAction={rsvpAction}
            checkInAction={checkInAction}
          />
        ) : null}
        {tab === 'attendance' ? (
          <AttendanceTab
            ctx={ctx}
            event={event}
            timeZone={tz}
            now={now}
            offset={offsetParam(query.offset)}
            issueCodeAction={issueCheckInCodeAction}
          />
        ) : null}
        {tab === 'teams' ? (
          <TeamsTab
            ctx={ctx}
            event={event}
            staff={staff}
            drawAction={drawTeamsAction}
            deleteAction={deleteTeamAction}
          />
        ) : null}
        {tab === 'bracket' ? (
          <BracketTab
            ctx={ctx}
            event={event}
            staff={staff}
            generateAction={generateBracketAction}
            reportAction={reportMatchAction}
          />
        ) : null}
        {tab === 'edit' ? (
          <Card className="max-w-3xl">
            <EventForm
              action={updateEventAction}
              limits={EVENT_FORM_LIMITS}
              values={editValues(event, tz)}
              submitLabel="Save changes"
              timeZone={tz}
              eventId={event.id}
              kindLocked={kindLocked}
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
