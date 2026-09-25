import { DAY, HOUR, MINUTE } from '../kernel/clock';

/** Personal (non-campaign) referral codes a member may hold active at once. */
export const MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER = 3;

/** Length of generated referral codes (Crockford-like alphabet without 0/O/1/I). */
export const REFERRAL_CODE_LENGTH = 8;

/** Retries when a generated referral code collides with an existing one. */
export const REFERRAL_CODE_GENERATION_ATTEMPTS = 5;

/** Referral codes must be claimed within this many days of joining the server. */
export const REFERRAL_CLAIM_WINDOW_DAYS = 30;

/** Failed/successful claim attempts allowed per user per window (anti-enumeration). */
export const REFERRAL_CLAIM_RATE_LIMIT = 10;
export const REFERRAL_CLAIM_RATE_WINDOW_SECONDS = 60 * 60;

/** Leaving within this long after joining is a FAST LEAVE. */
export const FAST_LEAVE_MS = DAY;

/** A prior join older than this marks the attribution as a REJOIN. */
export const REJOIN_GRACE_MS = 10 * MINUTE;

/** Tolerated clock difference between Discord's join timestamp and ours. */
export const MAX_JOIN_CLOCK_SKEW_MS = 5 * MINUTE;

/** Discord caps a guild at 1000 regular invites. */
export const DISCORD_MAX_GUILD_INVITES = 1000;

/** A complete snapshot: every regular invite plus the vanity URL. Anything larger is not real. */
export const MAX_SYNCED_INVITES = DISCORD_MAX_GUILD_INVITES + 1;

/** Referrals processed per batch by the lifecycle sweep. */
export const SWEEP_BATCH_SIZE = 200;

/** Upper bound on batches per sweep run; the next hourly run continues. */
export const SWEEP_MAX_BATCHES = 25;

/** How often the lifecycle sweep runs. */
export const REFERRAL_SWEEP_INTERVAL_MS = HOUR;

/** Referrals listed in the member-facing view. */
export const MY_REFERRALS_LIMIT = 50;

/** Largest leaderboard page, and the default size. */
export const LEADERBOARD_MAX_LIMIT = 50;
export const LEADERBOARD_DEFAULT_LIMIT = 10;

/** Name shown for a referred member whose profile is staff-only. */
export const PRIVATE_MEMBER_LABEL = 'Private member';
