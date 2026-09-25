import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export type TimelineTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const MARKER: Record<TimelineTone, string> = {
  neutral: 'border-line-strong bg-surface-raised',
  success: 'border-success/60 bg-success/20',
  warning: 'border-warning/60 bg-warning/20',
  danger: 'border-danger/60 bg-danger/20',
  info: 'border-info/60 bg-info/20',
};

export interface TimelineItem {
  id: string;
  title: ReactNode;
  /** Machine time for <time dateTime>. */
  at: Date | string;
  /** Human-formatted time (formatted by the caller for locale/timezone). */
  atLabel: string;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: TimelineTone;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  className?: string;
  label?: string;
}

/** Vertical rail with square markers — used for rank history and activity. */
export function Timeline({ items, className, label }: TimelineProps) {
  return (
    <ol aria-label={label} className={cx('relative space-y-6', className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative grid grid-cols-[16px_1fr] gap-x-4">
          {index < items.length - 1 ? (
            <span aria-hidden className="absolute left-[7.5px] top-5 -bottom-6 w-px bg-line" />
          ) : null}
          <span
            aria-hidden
            className={cx('mt-1 size-4 rounded-sm border', MARKER[item.tone ?? 'neutral'])}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 text-body text-fg">{item.title}</div>
              <time
                dateTime={typeof item.at === 'string' ? item.at : item.at.toISOString()}
                className="type-data shrink-0 text-small text-fg-subtle"
              >
                {item.atLabel}
              </time>
            </div>
            {item.description ? (
              <div className="mt-1 text-small text-fg-muted">{item.description}</div>
            ) : null}
            {item.meta ? <div className="mt-2 text-small text-fg-subtle">{item.meta}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
