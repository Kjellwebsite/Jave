import { HOUR } from '../kernel/clock';

/** Replaces free text a member wrote about themselves when their data is erased. */
export const ERASED_MARKER = '[erased]';
/** What an erased member is called wherever a name is still needed. */
export const ERASED_DISPLAY_NAME = 'Erased member';
/** `users.username` is NOT NULL; this placeholder never matches a Discord username (no dot). */
export const ERASED_USERNAME = 'erased';
/** Erased handles are `erased-<8 base32 characters>`: unique, and meaningless. */
export const ERASED_HANDLE_PREFIX = 'erased-';
export const ERASED_HANDLE_RANDOM_LENGTH = 8;

/** Identifiers shorter than this are only scrubbed where they are a whole value. */
export const MIN_SCRUB_LENGTH = 3;

export const EXPORT_FORMAT = 'jave.member-export';
export const EXPORT_VERSION = 1;
/** Exports per actor per window. An export reads a lot; nobody needs many a day. */
export const EXPORT_RATE_LIMIT = 3;
export const EXPORT_RATE_WINDOW_SECONDS = (24 * HOUR) / 1000;
/** Upper bound per exported section: a member's own history is far smaller. */
export const EXPORT_SECTION_LIMIT = 5_000;

export const MAX_REASON_LENGTH = 500;
export const MAX_SESSIONS_LISTED = 50;

/** Rows per UPDATE when scrubbing identifiers out of kept records. */
export const SCRUB_BATCH_SIZE = 500;
