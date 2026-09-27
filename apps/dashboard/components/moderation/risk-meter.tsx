import { cx, Mono } from '@jave/ui';
import { SEVERITY_LABELS, type Severity } from '@/lib/moderation-labels';

const MAX_RISK = 100;

type ScoredSeverity = Exclude<Severity, 'unscored'>;

/** Fill carries severity; the track is a faint step of the same status colour. */
const FILL: Record<ScoredSeverity, string> = {
  critical: 'bg-danger',
  elevated: 'bg-warning',
  low: 'bg-fg-subtle',
};
const TRACK: Record<ScoredSeverity, string> = {
  critical: 'bg-danger/15',
  elevated: 'bg-warning/15',
  low: 'bg-line',
};

export interface RiskMeterProps {
  score: number;
  severity: Severity;
  size?: 'sm' | 'md';
  /** Show the severity word next to the number (detail views). */
  showSeverity?: boolean;
  className?: string;
}

/**
 * A risk score readout: a thin meter plus the number, never colour alone.
 * Risk describes a security event, never a person. An unscored event (a
 * report nobody assessed) shows an empty, dashed track and NOT SCORED —
 * never a 0/100 that reads as "safe".
 */
export function RiskMeter({
  score,
  severity,
  size = 'sm',
  showSeverity = false,
  className,
}: RiskMeterProps) {
  const trackSize = size === 'md' ? 'h-2 min-w-32' : 'h-1.5 min-w-16';
  if (severity === 'unscored') {
    return (
      <div className={cx('flex min-w-0 items-center gap-2.5', className)}>
        <span
          aria-hidden
          className={cx('flex-1 rounded-full border border-dashed border-line-strong', trackSize)}
        />
        <span
          className={cx(
            'type-eyebrow shrink-0 text-info',
            size === 'md' ? 'text-small' : undefined,
          )}
        >
          {SEVERITY_LABELS.unscored}
        </span>
      </div>
    );
  }
  const value = Math.max(0, Math.min(MAX_RISK, Math.round(score)));
  return (
    <div className={cx('flex min-w-0 items-center gap-2.5', className)}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={MAX_RISK}
        aria-valuenow={value}
        aria-label={`Risk ${value} of ${MAX_RISK}, ${SEVERITY_LABELS[severity].toLowerCase()}`}
        className={cx('relative flex-1 overflow-hidden rounded-full', trackSize, TRACK[severity])}
      >
        <span
          aria-hidden
          className={cx('absolute inset-y-0 left-0 rounded-full', FILL[severity])}
          style={{ width: `${value}%` }}
        />
      </div>
      <Mono className={cx('shrink-0 tabular-nums', size === 'md' ? 'text-body' : 'text-small')}>
        {value}
        <span className="text-fg-subtle">/{MAX_RISK}</span>
      </Mono>
      {showSeverity ? (
        <span className="type-eyebrow shrink-0 text-fg-subtle">{SEVERITY_LABELS[severity]}</span>
      ) : null}
    </div>
  );
}
