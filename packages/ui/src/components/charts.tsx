'use client';

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from 'react';
import { cx } from '../lib/cx';
import {
  areaPaths,
  divergingLayout,
  gapBand,
  linePaths,
  niceScale,
  percentOf,
  pointIndex,
  pointX,
  slotIndex,
} from '../lib/chart';
import { formatCount } from '../lib/format';

/*
 * Time-series charts with a hover/focus readout. Tooltips enhance, never
 * gate: every value is also in the frame's table twin. Keyboard: focus the
 * chart, then ←/→ (Home/End) to step through the days.
 */

export interface ChartPoint {
  /** Stable key (e.g. the ISO day). */
  key: string;
  /** Human label shown in the readout (e.g. "2026-09-24"). */
  label: string;
  /** null = no data for this slot (distinct from 0). */
  value: number | null;
  /** Second series of a polarity pair, drawn below the baseline. */
  secondary?: number | null;
}

const DEFAULT_PLOT_HEIGHT = 120;
/** Above this many slots, columns sit 1px apart instead of 2px. */
const DENSE_SLOTS = 45;
/** Fraction of the plot width after which the readout flips to the left side. */
const READOUT_FLIP = 0.6;
const PERCENT = 100;

type Source = 'pointer' | 'keyboard';

function useActiveIndex(points: readonly ChartPoint[]) {
  const [active, setActive] = useState<{ index: number; source: Source } | null>(null);
  const lastWithData = useCallback(() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i]!.value !== null) return i;
    return points.length - 1;
  }, [points]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const current = active?.index ?? lastWithData();
    const next: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(points.length - 1, current + 1),
      Home: 0,
      End: points.length - 1,
    };
    if (event.key in next) {
      event.preventDefault();
      setActive({ index: next[event.key]!, source: 'keyboard' });
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };
  return {
    active,
    onKeyDown,
    onFocus: () => {
      if (points.length > 0) setActive({ index: lastWithData(), source: 'keyboard' });
    },
    onBlur: () => setActive(null),
    point: (index: number | null) => {
      if (index === null) setActive(null);
      else setActive({ index, source: 'pointer' });
    },
  };
}

function readoutText(point: ChartPoint, seriesLabel: string, secondaryLabel?: string): string {
  if (point.value === null) return `${point.label}: no data`;
  const parts = [`${point.label}: ${formatCount(point.value)} ${seriesLabel}`];
  if (secondaryLabel) parts.push(`${formatCount(point.secondary ?? 0)} ${secondaryLabel}`);
  return parts.join(', ');
}

function Readout({
  point,
  xPercent,
  seriesLabel,
  secondaryLabel,
  line,
}: {
  point: ChartPoint;
  xPercent: number;
  seriesLabel: string;
  secondaryLabel?: string;
  line?: boolean;
}) {
  const flip = xPercent > READOUT_FLIP * PERCENT;
  const key = line ? 'h-0.5 w-2.5 rounded-full' : 'h-2 w-1 rounded-[1px]';
  return (
    <div
      aria-hidden
      className={cx(
        'pointer-events-none absolute top-0 z-10 min-w-32 rounded-md border border-line-strong bg-surface-overlay px-2.5 py-2 shadow-md',
        flip ? '-translate-x-full' : '',
      )}
      style={{ left: `calc(${xPercent}% ${flip ? '- 10px' : '+ 10px'})` }}
    >
      <p className="type-data text-[11px] text-fg-subtle">{point.label}</p>
      {point.value === null ? (
        <p className="mt-1 text-small text-fg-subtle">No data</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          <li className="flex items-center gap-2">
            <span aria-hidden className={cx('shrink-0 bg-fg-muted', key)} />
            <span className="type-data text-small font-semibold text-fg">
              {formatCount(point.value)}
            </span>
            <span className="text-small text-fg-subtle">{seriesLabel}</span>
          </li>
          {secondaryLabel ? (
            <li className="flex items-center gap-2">
              <span aria-hidden className={cx('shrink-0 bg-neutral-500', key)} />
              <span className="type-data text-small font-semibold text-fg">
                {formatCount(point.secondary ?? 0)}
              </span>
              <span className="text-small text-fg-subtle">{secondaryLabel}</span>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function AxisLabels({ points }: { points: readonly ChartPoint[] }) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  return (
    <div className="type-data mt-1.5 flex justify-between pl-8 text-[10px] text-fg-subtle">
      <span>{first.label}</span>
      {points.length > 1 ? <span>{last.label}</span> : null}
    </div>
  );
}

interface ChartShellProps {
  label: string;
  describedBy: string;
  height: number;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  gridlines: ReactNode;
  children: ReactNode;
  overlay: ReactNode;
  liveText: string | null;
}

/** Shared frame: y-axis gutter, focusable plot, live region for keyboard readouts. */
function ChartShell({
  label,
  describedBy,
  height,
  onKeyDown,
  onFocus,
  onBlur,
  onPointerMove,
  onPointerLeave,
  gridlines,
  children,
  overlay,
  liveText,
}: ChartShellProps) {
  return (
    <div className="relative" style={{ height }}>
      {gridlines}
      <div
        role="group"
        aria-roledescription="chart"
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className="absolute inset-y-0 right-0 left-8 rounded-sm outline-offset-4"
      >
        {children}
        {overlay}
      </div>
      <span id={describedBy} className="sr-only">
        Use the left and right arrow keys to read each day.
      </span>
      <span className="sr-only" aria-live="polite">
        {liveText ?? ''}
      </span>
    </div>
  );
}

interface GridlinesProps {
  ticks: number[];
  max: number;
  /** Share of the height above the baseline (diverging charts). */
  baseline?: number;
  /** Ticks below the baseline (diverging charts), labelled as positive counts. */
  below?: { ticks: number[]; max: number };
}

function Gridlines({ ticks, max, baseline = 1, below }: GridlinesProps) {
  const lowerHeight = (1 - baseline) * PERCENT;
  const marks = [
    ...ticks.map((tick) => ({
      key: `u${tick}`,
      tick,
      bottom: lowerHeight + percentOf(tick, max) * baseline,
    })),
    ...(below?.ticks ?? [])
      .filter((tick) => tick > 0)
      .map((tick) => ({
        key: `d${tick}`,
        tick,
        bottom: lowerHeight - percentOf(tick, below?.max ?? 1) * (1 - baseline),
      })),
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {marks.map(({ key, tick, bottom }) => {
        return (
          <div key={key} className="absolute right-0 left-0" style={{ bottom: `${bottom}%` }}>
            <span className="type-data absolute left-0 w-6 -translate-y-1/2 text-right text-[10px] leading-none text-fg-subtle">
              {formatCount(tick)}
            </span>
            <span
              className={cx(
                'absolute right-0 left-8 h-px',
                tick === 0 ? 'bg-line-strong' : 'bg-line-subtle',
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Column chart ────────────────────────────────────────────────────────────

export interface ColumnChartProps {
  points: readonly ChartPoint[];
  /** Plural noun for the values, e.g. "joins". */
  seriesLabel: string;
  /** When set, `secondary` values are drawn below the baseline (polarity pair). */
  secondaryLabel?: string;
  /** Accessible name. */
  label: string;
  height?: number;
  className?: string;
}

/**
 * Daily counts as thin columns (flows). With a secondary series it becomes a
 * diverging chart on one shared scale: primary above, secondary below.
 */
export function ColumnChart({
  points,
  seriesLabel,
  secondaryLabel,
  label,
  height = DEFAULT_PLOT_HEIGHT,
  className,
}: ColumnChartProps) {
  const descriptionId = useId();
  const { active, onKeyDown, onFocus, onBlur, point } = useActiveIndex(points);
  const diverging = secondaryLabel !== undefined;
  const values = points.map((p) => p.value);
  const layout = diverging
    ? divergingLayout(
        values,
        points.map((p) => (p.value === null ? null : (p.secondary ?? 0))),
      )
    : null;
  const scale = niceScale(values.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0));
  const upMax = layout ? layout.upMax : scale.max;
  const baseline = layout ? layout.baseline : 1;
  const ticks = layout ? (layout.upMax > 0 ? niceScale(layout.upMax).ticks : [0]) : scale.ticks;
  const dense = points.length > DENSE_SLOTS;
  const activePoint = active ? points[active.index] : undefined;
  const activeX = active ? ((active.index + 0.5) / Math.max(1, points.length)) * PERCENT : 0;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    point(slotIndex(event.clientX - rect.left, rect.width, points.length));
  };

  return (
    <div className={cx('min-w-0', className)}>
      <ChartShell
        label={label}
        describedBy={descriptionId}
        height={height}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerMove={onPointerMove}
        onPointerLeave={() => point(null)}
        gridlines={
          <Gridlines
            ticks={ticks}
            max={Math.max(1, upMax)}
            baseline={baseline}
            below={
              layout && layout.downMax > 0
                ? { ticks: niceScale(layout.downMax).ticks, max: layout.downMax }
                : undefined
            }
          />
        }
        liveText={
          active?.source === 'keyboard' && activePoint
            ? readoutText(activePoint, seriesLabel, secondaryLabel)
            : null
        }
        overlay={
          activePoint ? (
            <Readout
              point={activePoint}
              xPercent={activeX}
              seriesLabel={seriesLabel}
              secondaryLabel={secondaryLabel}
            />
          ) : null
        }
      >
        <div aria-hidden className={cx('absolute inset-0 flex', dense ? 'gap-px' : 'gap-0.5')}>
          {points.map((p, index) => {
            const isActive = active?.index === index;
            const up = p.value ?? 0;
            const down = p.value === null ? 0 : (p.secondary ?? 0);
            return (
              <div
                key={p.key}
                className={cx(
                  'relative flex h-full min-w-0 flex-1 flex-col items-center',
                  p.value === null && 'bg-line-subtle/40',
                  isActive && 'bg-surface-raised',
                )}
              >
                <div
                  className="flex w-full items-end justify-center"
                  style={{ height: `${baseline * PERCENT}%` }}
                >
                  {up > 0 ? (
                    <div
                      className={cx(
                        'w-full max-w-6 rounded-t-[4px]',
                        isActive ? 'bg-fg' : 'bg-fg-muted',
                      )}
                      style={{ height: `${percentOf(up, upMax)}%` }}
                    />
                  ) : null}
                </div>
                {layout ? (
                  <div
                    className="flex w-full items-start justify-center"
                    style={{ height: `${(1 - baseline) * PERCENT}%` }}
                  >
                    {down > 0 ? (
                      <div
                        className={cx(
                          'w-full max-w-6 rounded-b-[4px]',
                          isActive ? 'bg-fg-muted' : 'bg-neutral-500',
                        )}
                        style={{ height: `${percentOf(down, layout.downMax)}%` }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </ChartShell>
      <AxisLabels points={points} />
    </div>
  );
}

// ─── Line chart ──────────────────────────────────────────────────────────────

export interface LineChartProps {
  points: readonly ChartPoint[];
  seriesLabel: string;
  label: string;
  height?: number;
  className?: string;
}

/**
 * A level over time (gauges): 2px line, 10% wash, end dot, crosshair readout.
 * Missing days break the line and are shaded, like the column charts' slots.
 */
export function LineChart({
  points,
  seriesLabel,
  label,
  height = DEFAULT_PLOT_HEIGHT,
  className,
}: LineChartProps) {
  const descriptionId = useId();
  const { active, onKeyDown, onFocus, onBlur, point } = useActiveIndex(points);
  const values = points.map((p) => p.value);
  const scale = niceScale(values.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0));
  const width = Math.max(1, points.length - 1);
  const lines = linePaths(values, scale.max);
  const areas = areaPaths(values, scale.max);
  const isolated = points
    .map((p, index) => ({ p, index }))
    .filter(
      ({ p, index }) =>
        p.value !== null &&
        (points[index - 1]?.value ?? null) === null &&
        (points[index + 1]?.value ?? null) === null,
    );
  let lastIndex = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]!.value !== null) {
      lastIndex = i;
      break;
    }
  }
  const activePoint = active ? points[active.index] : undefined;
  const dot = (index: number, emphasized: boolean) => {
    const value = points[index]?.value;
    if (value === null || value === undefined) return null;
    return (
      <span
        key={`dot-${index}`}
        aria-hidden
        className={cx(
          'absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-surface',
          emphasized ? 'bg-fg' : 'bg-fg-muted',
        )}
        style={{
          left: `${pointX(index, points.length)}%`,
          bottom: `${percentOf(value, scale.max)}%`,
        }}
      />
    );
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    point(pointIndex(event.clientX - rect.left, rect.width, points.length));
  };

  return (
    <div className={cx('min-w-0', className)}>
      <ChartShell
        label={label}
        describedBy={descriptionId}
        height={height}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerMove={onPointerMove}
        onPointerLeave={() => point(null)}
        gridlines={<Gridlines ticks={scale.ticks} max={scale.max} />}
        liveText={
          active?.source === 'keyboard' && activePoint
            ? readoutText(activePoint, seriesLabel)
            : null
        }
        overlay={
          active && activePoint ? (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
                style={{ left: `${pointX(active.index, points.length)}%` }}
              />
              {dot(active.index, true)}
              <Readout
                point={activePoint}
                xPercent={pointX(active.index, points.length)}
                seriesLabel={seriesLabel}
                line
              />
            </>
          ) : null
        }
      >
        {points.map((p, index) => {
          if (p.value !== null) return null;
          const band = gapBand(index, points.length);
          return (
            <span
              key={`gap-${p.key}`}
              aria-hidden
              className="absolute inset-y-0 bg-line-subtle/40"
              style={{ left: `${band.left}%`, width: `${band.width}%` }}
            />
          );
        })}
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox={`0 0 ${width} ${PERCENT}`}
          preserveAspectRatio="none"
        >
          {areas.map((d) => (
            <path key={`a-${d}`} d={d} className="fill-fg-muted/10" />
          ))}
          {lines.map((d) => (
            <path
              key={`l-${d}`}
              d={d}
              fill="none"
              className="stroke-fg-muted"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {isolated.map(({ index }) => (index === lastIndex ? null : dot(index, false)))}
        {lastIndex >= 0 && active?.index !== lastIndex ? dot(lastIndex, false) : null}
      </ChartShell>
      <AxisLabels points={points} />
    </div>
  );
}
