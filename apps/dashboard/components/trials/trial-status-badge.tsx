import { StatusBadge } from '@jave/ui';
import { TRIAL_STATUS_LABELS, TRIAL_STATUS_TONE, type TrialStatusKey } from '@/lib/trial-labels';

/** A trial's state. Only LIVE pulses; COMPLETED is the quiet, expected end. */
export function TrialStatusBadge({ status }: { status: TrialStatusKey }) {
  return (
    <StatusBadge
      tone={TRIAL_STATUS_TONE[status]}
      label={TRIAL_STATUS_LABELS[status].toUpperCase()}
      live={status === 'active'}
      quiet={status === 'completed'}
      data-status={status}
    />
  );
}
