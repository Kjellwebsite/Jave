import { MINUTE } from '../kernel/clock';
import type { TrialStatus } from './constants';

/**
 * Pure time rules.
 *
 * - deadline = startedAt + duration.
 * - Submissions stay open until closesAt = deadline + grace. Anything
 *   submitted after the deadline but before closesAt is flagged late; nothing
 *   is accepted after closesAt, or once submissions are closed manually.
 */

export type TrialPhase = 'not_started' | 'open' | 'grace' | 'closed';

export interface TimingInput {
  status: TrialStatus;
  deadlineAt: Date | null;
  graceMinutes: number;
  submissionsClosedAt: Date | null;
}

export interface TrialTiming {
  phase: TrialPhase;
  deadlineAt: Date | null;
  /** Last moment a (late) submission is accepted. */
  closesAt: Date | null;
  /** Milliseconds until the deadline; 0 once it has passed; null before the start. */
  msUntilDeadline: number | null;
  msUntilClose: number | null;
  /** e.g. "2h 15m", "45m", "under 1m", "closed". */
  remainingLabel: string;
}

export function computeDeadline(startedAt: Date, durationMinutes: number): Date {
  return new Date(startedAt.getTime() + durationMinutes * MINUTE);
}

export function closeTime(deadlineAt: Date, graceMinutes: number): Date {
  return new Date(deadlineAt.getTime() + graceMinutes * MINUTE);
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'closed';
  const totalMinutes = Math.floor(ms / MINUTE);
  if (totalMinutes < 1) return 'under 1m';
  const days = Math.floor(totalMinutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

const MULTI_DAY_HOURS = 72;

/** Trial length for cards: "90m", "6h", "48h", "4d 12h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${rest}m`;
  if (hours >= MULTI_DAY_HOURS) {
    const days = Math.floor(hours / HOURS_PER_DAY);
    const dayHours = hours % HOURS_PER_DAY;
    return dayHours === 0 ? `${days}d` : `${days}d ${dayHours}h`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "2026-03-03 12:00 UTC" — unambiguous in DMs and channels across time zones. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const NOT_STARTED: readonly TrialStatus[] = ['draft', 'recruiting', 'teams_assigned'];

function withoutClock(phase: TrialPhase, remainingLabel: string): TrialTiming {
  return {
    phase,
    deadlineAt: null,
    closesAt: null,
    msUntilDeadline: null,
    msUntilClose: null,
    remainingLabel,
  };
}

export function trialTiming(trial: TimingInput, now: Date): TrialTiming {
  if (NOT_STARTED.includes(trial.status)) return withoutClock('not_started', 'not started');
  // Cancelled before it ever started.
  if (!trial.deadlineAt) return withoutClock('closed', 'closed');
  const closesAt = closeTime(trial.deadlineAt, trial.graceMinutes);
  const msUntilDeadline = Math.max(0, trial.deadlineAt.getTime() - now.getTime());
  const msUntilClose = Math.max(0, closesAt.getTime() - now.getTime());
  const closed =
    trial.status !== 'active' || trial.submissionsClosedAt !== null || msUntilClose === 0;
  const phase: TrialPhase = closed ? 'closed' : msUntilDeadline > 0 ? 'open' : 'grace';
  return {
    phase,
    deadlineAt: trial.deadlineAt,
    closesAt,
    msUntilDeadline,
    msUntilClose: closed ? 0 : msUntilClose,
    remainingLabel:
      phase === 'open'
        ? formatRemaining(msUntilDeadline)
        : phase === 'grace'
          ? `grace ${formatRemaining(msUntilClose)}`
          : 'closed',
  };
}

export interface ScheduledWarning {
  minutes: number;
  runAt: Date;
}

/**
 * Deadline warnings still ahead of `now`, one per distinct lead time, largest
 * first. A warning is skipped when it would fire at or before the start.
 */
export function warningSchedule(
  deadlineAt: Date,
  warningsMinutes: readonly number[],
  now: Date,
): ScheduledWarning[] {
  const distinct = [...new Set(warningsMinutes)].filter((m) => Number.isInteger(m) && m > 0);
  return distinct
    .sort((a, b) => b - a)
    .map((minutes) => ({ minutes, runAt: new Date(deadlineAt.getTime() - minutes * MINUTE) }))
    .filter((warning) => warning.runAt.getTime() > now.getTime());
}
