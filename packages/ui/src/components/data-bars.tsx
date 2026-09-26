import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { formatRate, HEAT_INVERSE_TEXT_AT, heatIntensity, percentOf } from '../lib/chart';
import { formatCount } from '../lib/format';

/*
 * Static data readouts: bar lists, meters, stacked part-to-whole bars, heat
 * cells and the chart frame with its table twin. Server-safe (no hooks).
 * Marks carry colour; every label and value stays in text tokens.
 */

// ─── Bar list ────────────────────────────────────────────────────────────────

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Quiet trailing context, e.g. a share. */
  hint?: ReactNode;
}

export interface BarListProps {
  items: readonly BarListItem[];
  /** Accessible name of the list. */
  label: string;
  /** Scale maximum; defaults to the largest value. */
  max?: number;
  className?: string;
}

/**
 * Magnitudes across nominal categories: one hue for every bar, value
 * labelled at the tip, zeros kept (and dimmed) so the shape of the enum is
 * stable. Horizontal, so long category names never rotate.
 */
export function BarList({ items, label, max, className }: BarListProps) {
  const top = max ?? items.reduce((peak, item) => Math.max(peak, item.value), 0);
  return (
    <ul aria-label={label} className={cx('space-y-2.5', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
        >
          <span className="truncate text-small text-fg-muted">{item.label}</span>
          <span aria-hidden className="relative h-2 min-w-0">
            {item.value > 0 ? (
              <span
                className="absolute inset-y-0 left-0 min-w-0.5 rounded-r-[4px] bg-fg-muted"
                style={{ width: `${percentOf(item.value, top)}%` }}
              />
            ) : null}
          </span>
          <span
            className={cx(
              'type-data min-w-8 text-right text-small',
              item.value > 0 ? 'text-fg' : 'text-fg-subtle',
            )}
          >
            {formatCount(item.value)}
            {item.hint ? <span className="ml-1.5 text-fg-subtle">{item.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Meter ───────────────────────────────────────────────────────────────────

export interface MeterProps {
  label: string;
  /** A 0–1 rate; null when there is nothing to divide by yet. */
  value: number | null;
  /** One line of context, e.g. "42 of 60 joins stayed". */
  caption?: ReactNode;
  className?: string;
}

/** A single ratio against its whole: the track is the whole, the fill the share. */
export function Meter({ label, value, caption, className }: MeterProps) {
  const percent = value === null ? null : percentOf(value, 1);
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-eyebrow text-fg-subtle">{label}</span>
        <span className={cx('type-data text-heading', value === null ? 'text-fg-subtle' : 'text-fg')}>
          {formatRate(value)}
        </span>
      </div>
      <div
        role={percent === null ? undefined : 'meter'}
        aria-label={label}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
      >
        {percent !== null && percent > 0 ? (
          <div className="h-full rounded-full bg-fg-muted" style={{ width: `${percent}%` }} />
        ) : null}
      </div>
      {caption ? <p className="mt-2 text-small text-fg-subtle">{caption}</p> : null}
    </div>
  );
}

// ─── Stacked part-to-whole ───────────────────────────────────────────────────

/** Ordinal steps, strongest first (VERIFIED › CLAIMED › UNKNOWN). */
export type OrdinalStep = 1 | 2 | 3;

const STEP_FILL: Record<OrdinalStep, string> = {
  1: 'bg-fg',
  2: 'bg-fg-subtle',
  3: 'bg-fg-faint',
};

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  step: OrdinalStep;
}

export interface StackedBarProps {
  segments: readonly StackSegment[];
  /** Accessible summary, e.g. "Mind: 4 verified, 6 claimed only, 30 unknown". */
  label: string;
  className?: string;
}

/** Part-to-whole across ordered classes, separated by 2px surface gaps. */
export function StackedBar({ segments, label, className }: StackedBarProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <div
      role="img"
      aria-label={label}
      className={cx('flex h-2.5 gap-0.5 overflow-hidden rounded-r-[4px] bg-transparent', className)}
    >
      {total === 0 ? (
        <span className="h-full w-full rounded-r-[4px] bg-line" />
      ) : (
        segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.key}
              className={cx('h-full min-w-0.5', STEP_FILL[segment.step])}
              style={{ flexGrow: segment.value, flexBasis: 0 }}
            />
          ))
      )}
    </div>
  );
}

export interface LegendItem {
  key: string;
  label: string;
  step?: OrdinalStep;
  /** Marker shape mirrors the mark: rect for bars/areas, line for lines. */
  marker?: 'rect' | 'line';
  /** Series tone for non-ordinal marks. */
  tone?: 'primary' | 'secondary';
  value?: ReactNode;
}

const TONE_FILL = { primary: 'bg-fg-muted', secondary: 'bg-neutral-500' } as const;

/** Always present for two or more series; identity never rests on colour alone. */
export function ChartLegend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5 text-small text-fg-subtle">
          <span
            aria-hidden
            className={cx(
              'shrink-0',
              item.marker === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-[2px]',
              item.step ? STEP_FILL[item.step] : TONE_FILL[item.tone ?? 'primary'],
            )}
          />
          <span>{item.label}</span>
          {item.value !== undefined ? <span className="type-data text-fg">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// ─── Heat cell ───────────────────────────────────────────────────────────────

export interface HeatCellProps {
  value: number;
  max: number;
  className?: string;
}

/** Sequential single-hue cell: ink mixed into the surface by magnitude, count always printed. */
export function HeatCell({ value, max, className }: HeatCellProps) {
  const intensity = heatIntensity(value, max);
  const style: CSSProperties | undefined =
    intensity > 0
      ? {
          backgroundColor: `color-mix(in oklab, var(--color-fg) ${Math.round(intensity * 100)}%, transparent)`,
        }
      : undefined;
  return (
    <td
      style={style}
      className={cx(
        'type-data h-9 min-w-10 border border-surface px-2 text-center text-small',
        intensity === 0 && 'text-fg-subtle',
        intensity > 0 && intensity < HEAT_INVERSE_TEXT_AT && 'text-fg',
        intensity >= HEAT_INVERSE_TEXT_AT && 'text-fg-inverse',
        className,
      )}
    >
      {value > 0 ? formatCount(value) : '·'}
    </td>
  );
}

// ─── Chart frame with table twin ─────────────────────────────────────────────

export interface ChartTable {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}

export interface ChartFrameProps {
  title: string;
  /** The headline figure the chart explains (e.g. the range total). */
  value?: ReactNode;
  description?: ReactNode;
  legend?: ReactNode;
  /** Every chart ships its values as a table too (the accessible twin). */
  table?: ChartTable;
  children: ReactNode;
  className?: string;
}

export function ChartFrame({
  title,
  value,
  description,
  legend,
  table,
  children,
  className,
}: ChartFrameProps) {
  return (
    <figure className={cx('min-w-0', className)}>
      <figcaption className="mb-4 flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="type-eyebrow block text-fg-subtle">{title}</span>
          {description ? (
            <span className="mt-1 block text-small text-fg-subtle">{description}</span>
          ) : null}
        </span>
        {value !== undefined ? (
          <span className="type-data shrink-0 text-heading text-fg">{value}</span>
        ) : null}
      </figcaption>
      {children}
      {legend ? <div className="mt-3">{legend}</div> : null}
      {table ? (
        <details className="group mt-3">
          <summary className="type-eyebrow inline-flex cursor-pointer list-none items-center gap-1 text-fg-subtle hover:text-fg-muted [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show table</span>
            <span className="hidden group-open:inline">Hide table</span>
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line-subtle">
            <table className="w-full border-collapse text-left text-small">
              <caption className="sr-only">{table.caption}</caption>
              <thead className="sticky top-0 bg-surface-raised">
                <tr>
                  {table.columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="type-eyebrow px-3 py-2 font-medium text-fg-subtle"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-line-subtle">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="type-data px-3 py-1.5 text-fg-muted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
