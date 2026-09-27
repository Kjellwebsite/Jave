import { Timer } from 'lucide-react';
import { Badge, type BadgeTone, cx, EmptyState, Panel } from '@jave/ui';
import type { TrialWire } from '../../api/contract';
import { enumLabel, formatCountdown, formatTimestamp } from '../../lib/format';

interface Countdown {
  label: string;
  target: number | null;
  /** Start of the window the bar measures (null: no bar). */
  from: number | null;
  tone: BadgeTone;
  state: string;
}

/** What the member is counting down to, by trial phase. Server timestamps only. */
function countdownFor(trial: TrialWire): Countdown {
  switch (trial.phase) {
    case 'not_started':
      return {
        label: 'STARTS IN',
        target: trial.scheduledStartAt,
        from: null,
        tone: 'accent',
        state: 'SCHEDULED',
      };
    case 'open':
      return {
        label: 'DEADLINE IN',
        target: trial.deadlineAt,
        from: trial.startedAt,
        tone: 'success',
        state: 'RUNNING',
      };
    case 'grace':
      return {
        label: 'GRACE ENDS IN',
        target: trial.closesAt,
        from: trial.deadlineAt,
        tone: 'warning',
        state: 'GRACE PERIOD',
      };
    case 'closed':
      return { label: 'CLOSED', target: null, from: null, tone: 'neutral', state: 'CLOSED' };
  }
}

function elapsedFraction(from: number | null, to: number | null, now: number): number | null {
  if (from === null || to === null || to <= from) return null;
  return Math.min(1, Math.max(0, (now - from) / (to - from)));
}

/** The member's running (or next) trial with a live countdown. Never adversarial detail. */
export function TrialPanel({ trial, now }: { trial: TrialWire | null; now: number }) {
  if (!trial) {
    return (
      <Panel title="Trial" eyebrow="ACTIVE TRIAL">
        <EmptyState
          compact
          icon={Timer}
          title="NO ACTIVE TRIAL"
          description="When you are selected for a trial, its countdown runs here."
          className="py-4"
        />
      </Panel>
    );
  }
  const countdown = countdownFor(trial);
  const progress = elapsedFraction(countdown.from, countdown.target, now);
  return (
    <Panel
      title={trial.title}
      eyebrow={`ACTIVE TRIAL · ${trial.ref}`}
      description={[enumLabel(trial.category), trial.teamName ? `TEAM ${trial.teamName}` : null]
        .filter(Boolean)
        .join(' · ')}
      actions={<Badge tone={countdown.tone}>{countdown.state}</Badge>}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="type-eyebrow text-fg-subtle">{countdown.label}</p>
          {countdown.target !== null ? (
            <p
              className={cx(
                'type-numeral mt-2',
                countdown.tone === 'warning' ? 'text-warning' : 'text-fg',
              )}
              data-testid="trial-countdown"
            >
              {formatCountdown(countdown.target - now)}
            </p>
          ) : (
            <p className="mt-2 text-small text-fg-subtle">
              {trial.phase === 'closed'
                ? 'Submissions are closed. Evaluation follows.'
                : 'Start time not announced yet.'}
            </p>
          )}
        </div>
        {countdown.target !== null ? (
          <p className="type-data text-small text-fg-subtle">{formatTimestamp(countdown.target)}</p>
        ) : null}
      </div>
      {progress !== null ? (
        <div
          role="progressbar"
          aria-label="Time elapsed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mt-4 h-1 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cx(
              'h-full rounded-full',
              countdown.tone === 'warning' ? 'bg-warning' : 'bg-fg-muted',
            )}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      ) : null}
    </Panel>
  );
}
