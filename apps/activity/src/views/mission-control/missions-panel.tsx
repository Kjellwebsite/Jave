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

/** Active missions with their deadlines; the dashboard holds the full list. */
export function MissionsPanel({ missions, now }: { missions: MissionWire[]; now: number }) {
  return (
    <Panel
      title="Missions"
      eyebrow="ACTIVE"
      flush
      actions={
        missions.length > 0 ? (
          <span className="type-data text-small text-fg-subtle">{missions.length}</span>
        ) : null
      }
    >
      {missions.length === 0 ? (
        <EmptyState
          compact
          icon={Crosshair}
          title="NO ACTIVE MISSIONS"
          description="Missions assigned to you or accepted by you appear here with their deadlines."
          className="py-8"
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
        </ul>
      )}
    </Panel>
  );
}
