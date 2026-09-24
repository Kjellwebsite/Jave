import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../lib/cx';
import { formatRange, pageWindow } from '../lib/format';
import { type LinkComponent, PlainLink } from '../lib/link';
import { buttonStyles } from './button';
import { Icon } from './icon';

export interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  /** Build the URL for a given zero-based offset. */
  hrefForOffset: (offset: number) => string;
  linkComponent?: LinkComponent;
  className?: string;
  label?: string;
}

/** Previous/next pagination with an exact range readout ("26–50 of 132"). */
export function Pagination({
  offset,
  limit,
  total,
  hrefForOffset,
  linkComponent: Link = PlainLink,
  className,
  label = 'Pagination',
}: PaginationProps) {
  const pages = pageWindow({ offset, limit, total });
  const previousOffset = Math.max(0, (pages.page - 2) * limit);
  const nextOffset = pages.page * limit;
  const disabled = 'pointer-events-none opacity-40';
  return (
    <nav
      aria-label={label}
      className={cx('flex items-center justify-between gap-4 text-small', className)}
    >
      <p className="type-data text-fg-subtle" aria-live="polite">
        {formatRange(pages)}
      </p>
      <div className="flex items-center gap-2">
        <span className="type-data hidden text-fg-subtle sm:inline">
          {pages.page} / {pages.pageCount}
        </span>
        {pages.hasPrevious ? (
          <Link
            href={hrefForOffset(previousOffset)}
            rel="prev"
            className={buttonStyles({ size: 'sm' })}
          >
            <Icon icon={ChevronLeft} size="sm" />
            Previous
          </Link>
        ) : (
          <span aria-disabled className={buttonStyles({ size: 'sm', className: disabled })}>
            <Icon icon={ChevronLeft} size="sm" />
            Previous
          </span>
        )}
        {pages.hasNext ? (
          <Link
            href={hrefForOffset(nextOffset)}
            rel="next"
            className={buttonStyles({ size: 'sm' })}
          >
            Next
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        ) : (
          <span aria-disabled className={buttonStyles({ size: 'sm', className: disabled })}>
            Next
            <Icon icon={ChevronRight} size="sm" />
          </span>
        )}
      </div>
    </nav>
  );
}
