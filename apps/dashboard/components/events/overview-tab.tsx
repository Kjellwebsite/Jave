import { calendar } from '@jave/core';
import { Callout, cx, formatCount, Mono, Panel, StatusBadge } from '@jave/ui';
import { RSVP_LABELS, RSVP_TONE } from '@/lib/event-labels';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { CheckInForm } from './check-in-code';
import { RsvpControls } from './rsvp-controls';

const COUNT_ORDER: readonly { key: keyof calendar.RsvpCounts; label: string }[] = [
  { key: 'going', label: 'GOING' },
  { key: 'waitlist', label: 'WAITLIST' },
  { key: 'maybe', label: 'MAYBE' },
  { key: 'checkedIn', label: 'CHECKED IN' },
];

export function ResponseCounts({ counts }: { counts: calendar.RsvpCounts }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4">
      {COUNT_ORDER.map(({ key, label }) => (
        <div key={key} className="-mb-px -mr-px border-b border-r border-line-subtle px-4 py-4">
          <dt className="type-eyebrow text-[10px] text-fg-subtle">{label}</dt>
          <dd
            className={cx(
              'mt-2 font-display text-[22px] font-medium leading-none tabular-nums',
              counts[key] === 0 ? 'text-fg-subtle' : 'text-fg',
            )}
          >
            {formatCount(counts[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface OverviewTabProps {
  event: calendar.EventView;
  timeZone: string;
  now: Date;
  rsvpAction: FormAction;
  checkInAction: FormAction;
}

function responseLine(mine: calendar.MyRsvpView | null): string {
  if (!mine) return 'No response yet.';
  if (mine.status === 'waitlist') {
    return `On the waitlist${mine.waitlistPosition ? ` at #${mine.waitlistPosition}` : ''}. You move up automatically when a spot opens.`;
  }
  return `Responded ${mine.status === 'declined' ? 'no' : mine.status}.`;
}

/** Description, your response and check-in, and the response counts. */
export function OverviewTab({ event, timeZone, now, rsvpAction, checkInAction }: OverviewTabProps) {
  const mine = event.myRsvp;
  const open = event.status === 'scheduled' || event.status === 'live';
  const window = calendar.checkInWindow(event);
  const checkInOpen = open && now >= window.opensAt && now <= window.closesAt;
  return (
    <div className="space-y-6">
      {event.status === 'cancelled' ? (
        <Callout tone="danger" title="CANCELLED">
          {event.cancelReason ?? 'No reason given.'}
        </Callout>
      ) : null}
      <ResponseCounts counts={event.counts} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="About">
          {event.description ? (
            <p className="whitespace-pre-line break-words text-body text-fg-muted">
              {event.description}
            </p>
          ) : (
            <p className="text-small text-fg-subtle">No description.</p>
          )}
        </Panel>
        <Panel
          title="Your response"
          actions={
            mine ? (
              <StatusBadge
                tone={RSVP_TONE[mine.status]}
                label={RSVP_LABELS[mine.status].toUpperCase()}
              />
            ) : null
          }
        >
          <div className="space-y-4">
            <p className="text-small text-fg-subtle">{responseLine(mine)}</p>
            <RsvpControls
              eventId={event.id}
              action={rsvpAction}
              current={mine?.status ?? null}
              rsvpOpen={event.rsvpOpen}
              declineOpen={event.declineOpen}
            />
            {!event.rsvpOpen && open ? (
              <p className="text-small text-fg-subtle">RSVPs are closed.</p>
            ) : null}
            {mine?.checkedInAt ? (
              <p className="text-small text-success">
                Checked in{' '}
                <Mono className="text-success">{formatTimestamp(mine.checkedInAt, timeZone)}</Mono>
              </p>
            ) : checkInOpen && event.checkInCodeIssued ? (
              <div className="border-t border-line-subtle pt-4">
                <CheckInForm
                  eventId={event.id}
                  action={checkInAction}
                  codeMax={calendar.CHECK_IN_CODE_INPUT_MAX}
                />
              </div>
            ) : open ? (
              <p className="text-small text-fg-subtle">
                Check-in opens <Mono>{formatTimestamp(window.opensAt, timeZone)}</Mono> with the
                code shared at the event.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
