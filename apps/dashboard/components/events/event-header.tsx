import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { calendar } from '@jave/core';
import { Badge, Icon, Mono, StatusBadge } from '@jave/ui';
import {
  capacityLabel,
  EVENT_KIND_LABELS,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  locationDisplay,
} from '@/lib/event-labels';
import { formatTimestamp } from '@/lib/time';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 min-w-0 break-words">{children}</dd>
    </div>
  );
}

export interface EventHeaderProps {
  event: calendar.EventView;
  timeZone: string;
  actions?: ReactNode;
}

/** Title, kind and state, then the facts every tab shares. */
export function EventHeader({ event, timeZone, actions }: EventHeaderProps) {
  const where = locationDisplay(event.location);
  return (
    <>
      <header className="flex flex-col gap-6 border-b border-line-subtle pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <p className="type-eyebrow text-fg-subtle">
            <Link href="/events" className="hover:text-fg-muted">
              OPERATIONS / EVENTS
            </Link>
          </p>
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
            {event.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{EVENT_KIND_LABELS[event.kind]}</Badge>
            <StatusBadge
              live={event.status === 'live'}
              tone={EVENT_STATUS_TONE[event.status]}
              label={EVENT_STATUS_LABELS[event.status].toUpperCase()}
            />
            {event.discordScheduledEventId ? (
              <Mono dim className="text-[12px]">
                ON DISCORD
              </Mono>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Fact label="STARTS">
          <Mono className="text-fg">{formatTimestamp(event.startsAt, timeZone)}</Mono>
        </Fact>
        <Fact label="ENDS">
          <Mono>{formatTimestamp(event.endsAt, timeZone)}</Mono>
        </Fact>
        <Fact label="WHERE">
          {where.href ? (
            <a
              href={where.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex max-w-full items-center gap-1 text-small text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              <span className="truncate">{where.text}</span>
              <Icon icon={ArrowUpRight} size="sm" />
            </a>
          ) : (
            <span className="text-small text-fg-muted">{where.text}</span>
          )}
        </Fact>
        <Fact label="CAPACITY">
          <Mono>{capacityLabel(event)}</Mono>
        </Fact>
      </dl>
    </>
  );
}
