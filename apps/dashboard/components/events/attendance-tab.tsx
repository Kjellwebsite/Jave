import { calendar, type ServiceContext } from '@jave/core';
import { Card, Mono, Panel } from '@jave/ui';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { type CheckInCodeAction, CheckInCodeIssuer } from './check-in-code';
import { ParticipantsTable } from './participants-table';

/** Participants per page; the waitlist order is read in one page of the same size cap. */
const PARTICIPANTS_PAGE = 50;
const WAITLIST_WINDOW = 100;

export interface AttendanceTabProps {
  ctx: ServiceContext;
  event: calendar.EventView;
  timeZone: string;
  now: Date;
  offset: number;
  issueCodeAction: CheckInCodeAction;
}

/** Staff: check-in code and every response with its waitlist position and check-in. */
export async function AttendanceTab({
  ctx,
  event,
  timeZone,
  now,
  offset,
  issueCodeAction,
}: AttendanceTabProps) {
  const [page, waitlist] = await Promise.all([
    calendar.listParticipants(ctx, { eventId: event.id, limit: PARTICIPANTS_PAGE, offset }),
    event.counts.waitlist > 0
      ? calendar.listParticipants(ctx, {
          eventId: event.id,
          status: 'waitlist',
          limit: WAITLIST_WINDOW,
        })
      : null,
  ]);
  const positions = new Map(
    (waitlist?.items ?? []).map((participant, index) => [participant.memberId, index + 1]),
  );
  const window = calendar.checkInWindow(event);
  const codeOpen =
    (event.status === 'scheduled' || event.status === 'live') && now <= window.closesAt;

  return (
    <div className="space-y-6">
      <Panel
        title="Check-in"
        description={
          <>
            Window <Mono>{formatTimestamp(window.opensAt, timeZone)}</Mono> →{' '}
            <Mono>{formatTimestamp(window.closesAt, timeZone)}</Mono>
          </>
        }
      >
        {codeOpen ? (
          <CheckInCodeIssuer
            eventId={event.id}
            action={issueCodeAction}
            issued={event.checkInCodeIssued}
          />
        ) : (
          <p className="text-small text-fg-subtle">
            Check-in is closed. {event.counts.checkedIn} of {event.counts.going} going checked in.
          </p>
        )}
      </Panel>
      <Card padding="none">
        <ParticipantsTable
          page={page}
          timeZone={timeZone}
          waitlistPositions={positions}
          hrefForOffset={(next) =>
            `/events/${event.id}${toQueryString({ tab: 'attendance', offset: next || undefined })}`
          }
        />
      </Card>
    </div>
  );
}
