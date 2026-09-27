import Link from 'next/link';
import type { moderation } from '@jave/core';
import { cx, Mono, StatusBadge } from '@jave/ui';
import {
  EVENT_STATUS_LABELS,
  EVENT_STATUS_TONE,
  eventSeverity,
  SECURITY_ACTION_LABELS,
  TRIGGER_LABELS,
} from '@/lib/moderation-labels';
import { formatTimestamp } from '@/lib/time';
import { RiskMeter } from './risk-meter';

const ROW_GRID =
  '@4xl:grid-cols-[96px_minmax(0,1fr)_184px_128px_132px] @4xl:items-center @4xl:gap-x-5';
const HEADINGS = ['Event', 'Trigger · subject · evidence', 'Risk', 'Status', 'Raised'];

export interface EventListProps {
  events: readonly moderation.SecurityEventView[];
  thresholds: { critical: number; elevated: number };
  timeZone: string;
}

function subjectLabel(event: moderation.SecurityEventView): string {
  if (event.user) return event.user.name;
  return event.trigger === 'join_burst' ? 'Server-wide' : 'No specific member';
}

/** Security events: trigger, subject, evidence excerpt, risk meter, review status. */
export function EventList({ events, thresholds, timeZone }: EventListProps) {
  // Container queries: the row layout follows the list's own width (a full-width tab
  // or a side column), not the viewport.
  return (
    <div className="@container">
      <div
        aria-hidden
        className={cx('hidden border-b border-line px-5 py-2.5 @4xl:grid', ROW_GRID)}
      >
        {HEADINGS.map((heading) => (
          <span key={heading} className="type-eyebrow text-fg-subtle">
            {heading}
          </span>
        ))}
      </div>
      <ul aria-label="Security events" className="divide-y divide-line-subtle">
        {events.map((event) => {
          const severity = eventSeverity(event, thresholds);
          const excerpt = event.evidence.excerpt ?? event.evidence.signals[0]?.detail ?? null;
          return (
            <li key={event.id} data-event={event.reference}>
              <Link
                href={`/moderation/security/${event.id}`}
                className={cx(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-surface-raised/60 focus-visible:bg-surface-raised/60',
                  ROW_GRID,
                )}
              >
                <Mono className="text-small text-fg">{event.reference}</Mono>
                <span className="justify-self-end @4xl:hidden">
                  <StatusBadge
                    tone={EVENT_STATUS_TONE[event.status]}
                    label={EVENT_STATUS_LABELS[event.status]}
                  />
                </span>
                <span className="col-span-2 min-w-0 @4xl:col-span-1">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="text-body text-fg">{TRIGGER_LABELS[event.trigger]}</span>
                    <span className="truncate text-small text-fg-subtle">
                      {subjectLabel(event)} · {SECURITY_ACTION_LABELS[event.actionTaken]}
                    </span>
                  </span>
                  {excerpt ? (
                    <span className="mt-0.5 block truncate font-mono text-[12px] text-fg-subtle">
                      {excerpt}
                    </span>
                  ) : null}
                </span>
                <RiskMeter
                  score={event.riskScore}
                  severity={severity}
                  className="col-span-2 @4xl:col-span-1"
                />
                <span className="hidden @4xl:block">
                  <StatusBadge
                    tone={EVENT_STATUS_TONE[event.status]}
                    quiet={event.status === 'dismissed' || event.status === 'actioned'}
                    label={EVENT_STATUS_LABELS[event.status]}
                  />
                </span>
                <Mono dim className="col-span-2 text-[12px] @4xl:col-span-1">
                  {formatTimestamp(event.createdAt, timeZone)}
                </Mono>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
