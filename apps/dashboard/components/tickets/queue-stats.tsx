import type { tickets } from '@jave/core';
import { cx, formatCount } from '@jave/ui';
import { formatMinutes } from '@/lib/ticket-view';

export interface QueueStatsProps {
  counts: { active: number; unassigned: number; assignedToMe: number; missed: number };
  /** 30-day performance; present for ticket managers and analytics viewers. */
  performance: tickets.TicketStats | null;
}

interface Readout {
  key: string;
  label: string;
  value: string;
  /** Zero, or no data yet: read quietly so the real facts carry the eye. */
  quiet: boolean;
  hint?: string;
}

const PERCENT = 100;

function countReadout(key: string, label: string, value: number, hint?: string): Readout {
  return { key, label, value: formatCount(value), quiet: value === 0, hint };
}

function readouts({ counts, performance }: QueueStatsProps): Readout[] {
  const live = [
    countReadout('active', 'ACTIVE', counts.active),
    countReadout('unassigned', 'UNASSIGNED', counts.unassigned),
    countReadout('mine', 'ASSIGNED TO YOU', counts.assignedToMe),
    countReadout('missed', 'SLA MISSED', counts.missed, 'Still open'),
  ];
  if (!performance) return live;
  const median = performance.firstResponse.medianMinutes;
  const rate = performance.sla.breachRate;
  return [
    ...live,
    countReadout('opened', 'OPENED · 30D', performance.opened),
    countReadout('closed', 'CLOSED · 30D', performance.closed),
    {
      key: 'median',
      label: 'FIRST RESPONSE',
      value: median === null ? '—' : formatMinutes(median),
      quiet: median === null,
      hint: `Median of ${formatCount(performance.firstResponse.responded)}`,
    },
    {
      key: 'breach-rate',
      label: 'MISSED · 30D',
      value: rate === null ? '—' : `${Math.round(rate * PERCENT)}%`,
      quiet: rate === null || rate === 0,
      hint: `${formatCount(performance.sla.breached)} of ${formatCount(performance.sla.decided)} decided`,
    },
  ];
}

/**
 * The queue as an instrument strip: live counts for every handler, plus the
 * 30-day response record for those who may see ticket analytics. Four or
 * eight cells, so the grid never ends on a lone tile.
 */
export function QueueStats(props: QueueStatsProps) {
  const cells = readouts(props);
  return (
    <dl
      aria-label="Ticket statistics"
      className={cx(
        'grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4',
        cells.length > 4 && 'xl:grid-cols-8',
      )}
    >
      {cells.map((cell) => (
        <div
          key={cell.key}
          data-stat={cell.key}
          className="-mb-px -mr-px min-w-0 border-b border-r border-line-subtle px-4 py-4"
        >
          <dt className="type-eyebrow truncate text-[10px] text-fg-subtle" title={cell.label}>
            {cell.label}
          </dt>
          <dd
            className={cx(
              'mt-2 font-display text-[22px] font-medium leading-none tabular-nums',
              cell.quiet ? 'text-fg-subtle' : 'text-fg',
            )}
          >
            {cell.value}
          </dd>
          {cell.hint ? (
            <dd className="mt-1.5 truncate text-[12px] text-fg-subtle">{cell.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
