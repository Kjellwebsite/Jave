import { Crosshair } from 'lucide-react';
import { cx, EmptyState, Panel } from '@jave/ui';
import type { MissionWire } from '../../api/contract';
import { enumLabel, formatRelative, formatTimestamp } from '../../lib/format';

/** A deadline inside this window reads as urgent. */
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

function dueTone(dueAt: number, now: number): string {
  if (dueAt < now) return 'text-danger';
  if (dueAt - now < DUE_SOON_MS) return 'text-warning';
  return 'text-fg-muted';
}

export interface MissionsPanelProps {
  /** The active missions due soonest (the server sends at most five). */
  missions: MissionWire[];
  /** Every active mission, including the ones not listed here. */
  total: number;
  now: number;
}

/**
 * Active missions with their deadlines, soonest first. When there are more
 * than the panel lists, it says so and points to the dashboard's full list.
 */
export function MissionsPanel({ missions, total, now }: MissionsPanelProps) {
  const hidden = Math.max(0, total - missions.length);
  return (
    <Panel
      title="Missions"
      eyebrow={hidden > 0 ? 'ACTIVE · SOONEST DUE' : 'ACTIVE'}
      flush
      actions={
        missions.length > 0 ? (
          <span className="type-data text-small text-fg-subtle" data-testid="missions-count">
            {hidden > 0 ? `${missions.length} OF ${total}` : missions.length}
          </span>
        ) : null
      }
    >
      {missions.length === 0 ? (
        <EmptyState
          compact
          icon={Crosshair}
          title="NO ACTIVE MISSIONS"
          description="Missions assigned to you or accepted by you appear here with their deadlines."
          className="py-8!"
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {missions.map((mission) => (
            <li key={mission.assignmentId} className="flex items-start gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-fg">{mission.title}</p>
                <p className="type-eyebrow mt-1 truncate text-fg-subtle">
                  {[mission.number, enumLabel(mission.type), enumLabel(mission.status)].join(' · ')}
                </p>
                {mission.dueAt !== null ? (
                  <p className="type-data mt-1 text-[11px] text-fg-subtle">
                    DUE {formatTimestamp(mission.dueAt)}
                  </p>
                ) : null}
              </div>
              <p
                className={cx(
                  'type-eyebrow shrink-0 pt-0.5',
                  mission.dueAt === null ? 'text-fg-subtle' : dueTone(mission.dueAt, now),
                )}
              >
                {mission.dueAt === null
                  ? 'NO DEADLINE'
                  : formatRelative(mission.dueAt - now).toUpperCase()}
              </p>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="px-5 py-3 text-small text-fg-subtle" data-testid="missions-more">
              {hidden === 1 ? '1 more mission' : `${hidden} more missions`}, due later or without a
              deadline. The dashboard lists every active mission.
            </li>
          ) : null}
        </ul>
      )}
    </Panel>
  );
}
