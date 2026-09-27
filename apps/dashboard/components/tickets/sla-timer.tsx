'use client';

import { useEffect, useState } from 'react';
import { cx } from '@jave/ui';
import { type SlaInput, slaReadout, type TicketStatus, type Tone } from '@/lib/ticket-view';

/** Countdowns move in whole minutes; a 20 s tick keeps them within a minute of true. */
const TICK_MS = 20_000;

const TEXT: Record<Tone, string> = {
  neutral: 'text-fg-muted',
  info: 'text-info',
  success: 'text-fg-subtle',
  warning: 'text-warning',
  danger: 'text-danger',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-fg-faint',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface SlaTimerProps {
  sla: SlaInput;
  ticket: { createdAt: Date; status: TicketStatus };
  /** Server render time, so the first paint matches the server's HTML. */
  renderedAt: Date;
  /** Absolute due time for the tooltip, formatted in the viewer's time zone. */
  dueLabel?: string;
  className?: string;
}

/**
 * First-response target as a calm, live readout ("Due in 42m", "Overdue 8m",
 * "Met in 14m", "Missed"). It ticks while a deadline is running and stops
 * once the outcome is settled. The outcome itself always comes from core.
 */
export function SlaTimer({ sla, ticket, renderedAt, dueLabel, className }: SlaTimerProps) {
  const [now, setNow] = useState(renderedAt);
  const readout = slaReadout(sla, ticket, now);

  useEffect(() => {
    if (!readout.ticking) return;
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [readout.ticking]);

  const content = (
    <>
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', DOT[readout.tone])} />
      <span className="truncate">{readout.label}</span>
    </>
  );
  const classes = cx(
    'type-data inline-flex min-w-0 items-center gap-1.5 text-small',
    TEXT[readout.tone],
    className,
  );
  if (sla.dueAt && readout.ticking) {
    return (
      <time
        dateTime={sla.dueAt.toISOString()}
        title={dueLabel ? `Due ${dueLabel}` : undefined}
        className={classes}
        data-sla-tone={readout.tone}
      >
        {content}
      </time>
    );
  }
  return (
    <span className={classes} data-sla-tone={readout.tone}>
      {content}
    </span>
  );
}
