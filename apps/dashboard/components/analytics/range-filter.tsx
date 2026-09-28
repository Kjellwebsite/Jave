import Link from 'next/link';
import { cx } from '@jave/ui';
import { ANALYTICS_RANGES, type AnalyticsRange } from '@/lib/analytics-view';

export interface RangeFilterProps {
  current: AnalyticsRange;
  /** Page path the filter links to, e.g. "/analytics". */
  basePath: string;
}

/** Date range first: one segmented row above everything it scopes. */
export function RangeFilter({ current, basePath }: RangeFilterProps) {
  return (
    <nav
      aria-label="Time range"
      className="inline-flex rounded-md border border-line-strong bg-surface p-0.5"
    >
      {ANALYTICS_RANGES.map((range) => {
        const active = range === current;
        return (
          <Link
            key={range}
            href={`${basePath}?range=${range}`}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'type-eyebrow inline-flex h-7 min-w-11 items-center justify-center rounded-sm px-3 transition-colors',
              active
                ? 'bg-surface-raised text-fg shadow-sm'
                : 'text-fg-subtle hover:bg-surface-raised/60 hover:text-fg-muted',
            )}
          >
            <span aria-hidden>{range}D</span>
            <span className="sr-only">Last {range} days</span>
          </Link>
        );
      })}
    </nav>
  );
}
