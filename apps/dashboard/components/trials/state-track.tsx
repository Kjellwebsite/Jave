import { cx } from '@jave/ui';
import { TRIAL_STATUS_LABELS, TRIAL_TRACK, type TrialStatusKey } from '@/lib/trial-labels';

/**
 * The trial state machine as a machined rail: done steps solid, the current
 * step outlined in chrome, the rest faint. A cancelled trial shows where it
 * stopped.
 */
export function StateTrack({
  status,
  cancelledFrom,
}: {
  status: TrialStatusKey;
  /** For cancelled trials: the last state reached before cancelling, when known. */
  cancelledFrom?: TrialStatusKey | null;
}) {
  const reached = status === 'cancelled' ? (cancelledFrom ?? null) : status;
  const reachedIndex = reached ? TRIAL_TRACK.indexOf(reached) : -1;
  return (
    <ol aria-label="Trial state" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {TRIAL_TRACK.map((step, index) => {
        const current = status !== 'cancelled' && step === status;
        const done = index < reachedIndex || (status === 'completed' && step === 'completed');
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            data-step={step}
            data-state={current ? 'current' : done ? 'done' : 'upcoming'}
            className="min-w-0"
          >
            <span
              aria-hidden
              className={cx(
                'block h-1 rounded-full',
                current ? 'bg-fg' : done ? 'bg-fg-muted' : 'bg-line-strong',
              )}
            />
            <span
              className={cx(
                'type-eyebrow mt-2 block truncate',
                current ? 'text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle',
              )}
            >
              {TRIAL_STATUS_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
