import type { ReactNode } from 'react';
import { cx, formatCount, SectionHeader } from '@jave/ui';

/**
 * Three panels side by side from xl; below that two, with the third panel
 * spanning the full row (never a lone narrow panel), and one on phones.
 */
export const THREE_PANEL_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';
/** Applied to the third panel of a THREE_PANEL_GRID. */
export const WIDE_THIRD = 'md:col-span-2 xl:col-span-1';

export interface Readout {
  /**
   * Keep it short (≤ 15 characters): readout labels share half a panel and
   * truncate rather than wrap, so the numbers stay aligned.
   */
  label: string;
  value: number | string | null;
  hint?: ReactNode;
}

/**
 * A compact definition grid of counts inside a panel. Zeros and unknowns
 * read quieter so the non-zero facts carry the eye. Pass a multiple of the
 * column count: an empty cell would show as a blank block.
 */
export function ReadoutGrid({
  items,
  columns = 3,
  className,
}: {
  items: readonly Readout[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cx(
        'grid gap-px overflow-hidden rounded-md border border-line-subtle bg-line-subtle',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-3',
        columns === 4 && 'grid-cols-2 sm:grid-cols-4',
        className,
      )}
    >
      {items.map((item) => {
        const display =
          typeof item.value === 'number' ? formatCount(item.value) : (item.value ?? '—');
        const quiet = item.value === 0 || item.value === null || item.value === '—';
        return (
          <div key={item.label} className="min-w-0 bg-surface px-3 py-2.5">
            <dt className="type-eyebrow truncate text-[10px] text-fg-subtle" title={item.label}>
              {item.label}
            </dt>
            <dd className={cx('type-data mt-1 text-heading', quiet ? 'text-fg-subtle' : 'text-fg')}>
              {display}
            </dd>
            {item.hint ? (
              <dd className="mt-0.5 text-[12px] text-pretty text-fg-subtle">{item.hint}</dd>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

/** A quiet eyebrow naming the scope of the readout below it (e.g. "BY STATUS · ALL TIME"). */
export function SubHeading({ children }: { children: ReactNode }) {
  return <p className="type-eyebrow mb-3 text-fg-subtle">{children}</p>;
}

/** Section heading with an id so the page can be deep-linked. */
export function AnalyticsSection({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <SectionHeader id={id} title={title} description={description} actions={actions} />
      {children}
    </section>
  );
}
