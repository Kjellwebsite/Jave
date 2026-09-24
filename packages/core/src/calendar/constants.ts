import { DAY, HOUR, MINUTE } from '../kernel/clock';

// ─── Event content (Discord Scheduled Event limits: name ≤ 100, description ≤ 1000, location ≤ 100)
export const EVENT_TITLE_MIN = 3;
export const EVENT_TITLE_MAX = 100;
export const EVENT_DESCRIPTION_MAX = 1000;
export const EVENT_LOCATION_MAX = 100;
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 500;
export const MAX_EVENT_CAPACITY = 10_000;

// ─── Event timing
/** Used when the host gives no end time. */
export const DEFAULT_EVENT_DURATION_MS = 2 * HOUR;
export const MAX_EVENT_DURATION_MS = 7 * DAY;
/** How far ahead an event may be scheduled. */
export const MAX_SCHEDULE_HORIZON_MS = 400 * DAY;
/** Check-in opens this long before the start and closes at the end. */
export const CHECK_IN_OPENS_BEFORE_MS = 30 * MINUTE;
/** An event may go live no earlier than this before its start. */
export const GO_LIVE_EARLIEST_BEFORE_MS = CHECK_IN_OPENS_BEFORE_MS;
/** Scheduled/live events this long past their end are completed by the sweep. */
export const AUTO_COMPLETE_GRACE_MS = 12 * HOUR;

// ─── Reminders
export const EVENT_REMINDERS = [
  { key: '24h', offsetMs: DAY, title: 'EVENT IN 24 HOURS' },
  { key: '1h', offsetMs: HOUR, title: 'EVENT IN 1 HOUR' },
] as const;
export type ReminderKey = (typeof EVENT_REMINDERS)[number]['key'];

// ─── Check-in codes
export const CHECK_IN_CODE_LENGTH = 8;
/** Codes are displayed as two groups (ABCD-EFGH) for readability. */
export const CHECK_IN_CODE_GROUP = 4;
export const CHECK_IN_CODE_INPUT_MAX = 32;
export const CHECK_IN_ATTEMPT_LIMIT = 5;
export const CHECK_IN_ATTEMPT_WINDOW_SECONDS = 600;

// ─── RSVPs
/** Per-member RSVP changes, across events (surfaces add their own limits on top). */
export const RSVP_RATE_LIMIT = 20;
export const RSVP_RATE_WINDOW_SECONDS = 60;
/** RSVP count changes refresh the Discord announcement once per window of this length per event. */
export const ANNOUNCEMENT_REFRESH_WINDOW_MS = 30_000;

// ─── Teams & tournaments
export const TEAM_NAME_MAX = 64;
export const MAX_TEAM_SIZE = 12;
export const MAX_TEAMS_PER_EVENT = 128;
export const MIN_BRACKET_TEAMS = 2;
export const MAX_BRACKET_TEAMS = 128;
export const MAX_MATCH_SCORE = 1_000_000;
export const TEAM_SEED_MAX = 64;
export const RANDOM_TEAM_NAME_PREFIX = 'Team';

// ─── Background work
export const CALENDAR_SWEEP_EVERY_MS = 15 * MINUTE;
export const SWEEP_BATCH_LIMIT = 100;

// ─── Job types (non-Discord)
export const CALENDAR_REMINDER_JOB = 'calendar.reminder';
export const CALENDAR_SWEEP_JOB = 'calendar.sweep';
