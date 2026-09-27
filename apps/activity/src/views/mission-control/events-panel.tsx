import { CalendarDays, Hash, Link2, MapPin } from 'lucide-react';
import { Badge, EmptyState, Icon, Panel } from '@jave/ui';
import type { EventWire } from '../../api/contract';
import { enumLabel, formatRelative } from '../../lib/format';

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const LOCATION_ICON = { channel: Hash, url: Link2, text: MapPin } as const;

function DateBlock({ at }: { at: number }) {
  const date = new Date(at);
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-md border border-line bg-surface-raised py-1.5">
      <span className="type-eyebrow text-[10px] text-fg-subtle">
        {MONTH.format(date).toUpperCase()}
      </span>
      <span className="font-display text-[18px] font-medium leading-tight tabular-nums text-fg">
        {date.getDate()}
      </span>
    </div>
  );
}

/** The next events on the JAVELIN calendar, with the viewer's RSVP. */
export function EventsPanel({ events, now }: { events: EventWire[]; now: number }) {
  return (
    <Panel title="Events" eyebrow="UPCOMING" flush>
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarDays}
          title="NOTHING SCHEDULED"
          description="Workshops, talks and build nights appear here once they are published."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-5 py-3">
              <DateBlock at={event.startsAt} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-fg">{event.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-fg-subtle">
                  <span className="type-data">{TIME.format(new Date(event.startsAt))}</span>
                  <span aria-hidden>·</span>
                  <span className="type-eyebrow">{enumLabel(event.kind)}</span>
                  {event.status === 'live' ? <Badge tone="success">LIVE</Badge> : null}
                </p>
                {event.location ? (
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 text-small text-fg-subtle">
                    <Icon icon={LOCATION_ICON[event.location.kind]} size="sm" />
                    <span className="truncate">{event.location.label}</span>
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="type-eyebrow text-fg-muted">
                  {formatRelative(event.startsAt - now).toUpperCase()}
                </span>
                {event.myRsvp ? <Badge tone="info">{enumLabel(event.myRsvp)}</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
