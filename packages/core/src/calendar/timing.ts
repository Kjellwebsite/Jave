import { ValidationError } from '../kernel/errors';
import {
  CHECK_IN_OPENS_BEFORE_MS,
  DEFAULT_EVENT_DURATION_MS,
  EVENT_REMINDERS,
  MAX_EVENT_DURATION_MS,
  MAX_SCHEDULE_HORIZON_MS,
  type ReminderKey,
} from './constants';

/** Pure time rules for events. All instants are absolute (UTC); no local-time math. */

export interface EventTimes {
  startsAt: Date;
  endsAt: Date;
  rsvpClosesAt: Date | null;
}

export function resolveEventTimes(input: {
  startsAt: Date;
  endsAt?: Date | null;
  rsvpClosesAt?: Date | null;
}): EventTimes {
  return {
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? new Date(input.startsAt.getTime() + DEFAULT_EVENT_DURATION_MS),
    rsvpClosesAt: input.rsvpClosesAt ?? null,
  };
}

function invalid(path: string, message: string): never {
  throw new ValidationError(`${path}: ${message}`, [{ path, message }]);
}

/**
 * Throws ValidationError unless the times are coherent. The "future" checks
 * apply to values that are new or changed: an event whose RSVPs already
 * closed may still get a new title.
 */
export function validateEventTimes(
  times: EventTimes,
  now: Date,
  options: { requireFutureStart: boolean; requireFutureRsvpClose: boolean },
): void {
  const start = times.startsAt.getTime();
  const end = times.endsAt.getTime();
  if (options.requireFutureStart && start <= now.getTime()) {
    invalid('startsAt', 'must be in the future');
  }
  if (start > now.getTime() + MAX_SCHEDULE_HORIZON_MS) {
    invalid('startsAt', 'is too far ahead');
  }
  if (end <= start) invalid('endsAt', 'must be after the start');
  if (end - start > MAX_EVENT_DURATION_MS) invalid('endsAt', 'events may last at most 7 days');
  if (times.rsvpClosesAt) {
    const closes = times.rsvpClosesAt.getTime();
    if (closes > start) invalid('rsvpClosesAt', 'must be at or before the start');
    if (options.requireFutureRsvpClose && closes <= now.getTime()) {
      invalid('rsvpClosesAt', 'must be in the future');
    }
  }
}

/** RSVPs are accepted until rsvpClosesAt (exclusive), or the end when none is set. */
export function isRsvpOpen(event: { endsAt: Date; rsvpClosesAt: Date | null }, now: Date): boolean {
  const closes = event.rsvpClosesAt ?? event.endsAt;
  return now.getTime() < closes.getTime();
}

/** Declining is allowed until the end: it frees a spot for the waitlist. */
export function isDeclineOpen(event: { endsAt: Date }, now: Date): boolean {
  return now.getTime() < event.endsAt.getTime();
}

export interface CheckInWindow {
  opensAt: Date;
  closesAt: Date;
}

/** Inclusive on both ends: [startsAt − 30 min, endsAt]. */
export function checkInWindow(event: { startsAt: Date; endsAt: Date }): CheckInWindow {
  return {
    opensAt: new Date(event.startsAt.getTime() - CHECK_IN_OPENS_BEFORE_MS),
    closesAt: new Date(event.endsAt.getTime()),
  };
}

export type CheckInTiming = 'early' | 'open' | 'closed';

export function checkInTiming(event: { startsAt: Date; endsAt: Date }, now: Date): CheckInTiming {
  const window = checkInWindow(event);
  if (now.getTime() < window.opensAt.getTime()) return 'early';
  if (now.getTime() > window.closesAt.getTime()) return 'closed';
  return 'open';
}

export interface PlannedReminder {
  key: ReminderKey;
  runAt: Date;
}

/** Reminders still in the future for an event starting at `startsAt`. */
export function plannedReminders(startsAt: Date, now: Date): PlannedReminder[] {
  return EVENT_REMINDERS.map((reminder) => ({
    key: reminder.key,
    runAt: new Date(startsAt.getTime() - reminder.offsetMs),
  })).filter((reminder) => reminder.runAt.getTime() > now.getTime());
}
