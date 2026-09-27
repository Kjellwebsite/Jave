import type { trials } from '@jave/core';
import { Mono } from '@jave/ui';
import { formatTimestamp } from '@/lib/time';
import { Countdown } from './countdown';

type Summary = Pick<
  trials.TrialSummaryView,
  | 'status'
  | 'recruitmentClosesAt'
  | 'scheduledStartAt'
  | 'submissionsClosedAt'
  | 'completedAt'
  | 'cancelledAt'
  | 'timing'
>;

export interface TrialClockProps {
  trial: Summary;
  now: Date;
  timeZone: string;
  /** Stacked label above the value (detail pages) instead of one line (tables). */
  stacked?: boolean;
}

interface ClockReading {
  label: string;
  target?: Date;
  passed?: string;
  at?: Date;
}

/** The time that matters for the trial's current state. */
export function clockReading(trial: Summary): ClockReading | null {
  const { timing } = trial;
  switch (trial.status) {
    case 'draft':
      return null;
    case 'recruiting':
      return trial.recruitmentClosesAt
        ? { label: 'Recruitment closes', target: trial.recruitmentClosesAt, passed: 'closed' }
        : { label: 'Recruitment', passed: 'open until closed by staff' };
    case 'teams_assigned':
      return trial.scheduledStartAt
        ? { label: 'Starts', target: trial.scheduledStartAt, passed: 'start overdue' }
        : { label: 'Start', passed: 'on staff signal' };
    case 'active':
      if (timing.phase === 'open' && timing.deadlineAt)
        return { label: 'Deadline', target: timing.deadlineAt, passed: 'passed' };
      if (timing.phase === 'grace' && timing.closesAt)
        return { label: 'Late window', target: timing.closesAt, passed: 'closing' };
      return { label: 'Submissions', passed: 'closing' };
    case 'evaluating':
      return { label: 'Submissions closed', at: trial.submissionsClosedAt ?? undefined };
    case 'completed':
      return { label: 'Completed', at: trial.completedAt ?? undefined };
    case 'cancelled':
      return { label: 'Cancelled', at: trial.cancelledAt ?? undefined };
  }
}

/** Countdown to the next moment (recruitment close, start, deadline) or when it ended. */
export function TrialClock({ trial, now, timeZone, stacked = false }: TrialClockProps) {
  const reading = clockReading(trial);
  if (!reading) return <Mono dim>—</Mono>;
  const value = reading.target ? (
    <Countdown
      target={reading.target.toISOString()}
      serverNow={now.getTime()}
      passedLabel={reading.passed ?? '—'}
    />
  ) : reading.at ? (
    <Mono>{formatTimestamp(reading.at, timeZone)}</Mono>
  ) : (
    <span className="text-small text-fg-subtle">{reading.passed}</span>
  );
  if (stacked)
    return (
      <div className="min-w-0">
        <p className="type-eyebrow text-fg-subtle">{reading.label.toUpperCase()}</p>
        <div className="mt-1.5 text-[18px] leading-tight">{value}</div>
      </div>
    );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="text-small text-fg-subtle">{reading.label}</span>
      {value}
    </span>
  );
}
