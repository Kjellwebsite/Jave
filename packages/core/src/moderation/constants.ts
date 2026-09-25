import { MINUTE } from '../kernel/clock';

/** Discord's hard limit for a member timeout (communication disabled): 28 days. */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;
/** Shortest timeout JAVE issues. */
export const MIN_TIMEOUT_SECONDS = 60;
/** Shortest timed quarantine. */
export const MIN_QUARANTINE_SECONDS = 60;
/** Longest timed quarantine. Indefinite quarantine omits the duration. */
export const MAX_QUARANTINE_SECONDS = 90 * 24 * 60 * 60;
/** Discord allows deleting up to 7 days of message history when banning. */
export const MAX_BAN_DELETE_MESSAGE_DAYS = 7;

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 1000;
export const MAX_REVIEW_NOTE_LENGTH = 1000;
/** Discord audit-log reasons are capped at 512 characters. */
export const DISCORD_AUDIT_REASON_MAX = 512;
/** Discord message content limit (DM notices). */
export const DISCORD_MESSAGE_MAX = 2000;
/** Stored sync errors are capped. */
export const MAX_SYNC_ERROR_LENGTH = 500;
/** Longest sync error the bot may report (truncated before storage). */
export const MAX_SYNC_ERROR_INPUT = 2000;

/** Evidence: excerpts are truncated; never full message history. */
export const EVIDENCE_EXCERPT_MAX = 300;
export const EVIDENCE_MAX_MESSAGE_IDS = 20;
export const EVIDENCE_MAX_SIGNALS = 16;
export const SIGNAL_DETAIL_MAX = 120;
/** Longest signal detail accepted from callers (truncated to SIGNAL_DETAIL_MAX). */
export const SIGNAL_DETAIL_INPUT_MAX = 500;
export const MAX_DEDUPE_KEY_LENGTH = 128;

/** Content longer than this is truncated before scanning (Discord's own cap is 4000). */
export const MAX_SCAN_CHARS = 8000;
/** At most this many recent messages are considered per evaluation. */
export const MAX_RECENT_MESSAGES = 200;
/** Duplicate detection looks back this many spam windows. */
export const DUPLICATE_WINDOW_FACTOR = 6;
/** Normalized messages shorter than this are never counted as duplicates ("ok", "lol"). */
export const DUPLICATE_MIN_LENGTH = 4;

/** Case history returned in one call. */
export const MAX_CASE_HISTORY = 100;
/** Expired quarantines released per sweep run. */
export const SWEEP_BATCH_SIZE = 100;
export const SWEEP_INTERVAL_MS = MINUTE;

/** Own-invite codes are cached briefly per process. */
export const INVITE_CODES_CACHE_MS = MINUTE;
export const MAX_OWN_INVITE_CODES = 1000;

/** Staff alert fan-out cap per security event. */
export const ALERT_RECIPIENT_LIMIT = 50;
