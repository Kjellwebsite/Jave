import { HOUR, MINUTE } from '../kernel/clock';

/** A host may run this many lobby/active sessions at once. */
export const MAX_LIVE_SESSIONS_PER_HOST = 3;
/** Lobbies idle this long are abandoned by the sweep. */
export const LOBBY_IDLE_TTL_MS = 30 * MINUTE;
/** Active sessions with no progress this long are abandoned by the sweep. */
export const ACTIVE_IDLE_TTL_MS = 2 * HOUR;
export const GAMES_SWEEP_EVERY_MS = 5 * MINUTE;
export const GAMES_SWEEP_BATCH_LIMIT = 100;
/** Entropy of the per-session seed (base64url, 32 chars). */
export const SESSION_SEED_BYTES = 24;
/** Serialized move payloads above this size are rejected before parsing. */
export const MAX_MOVE_BYTES = 1024;
/** Serialized config payloads above this size are rejected before parsing. */
export const MAX_CONFIG_BYTES = 4096;
/**
 * Player-initiated ticks only advance transitions overdue by this much; the
 * worker handles anything more recent, so no player can trigger (and see)
 * a new question or GO before everyone else.
 */
export const USER_TICK_OVERDUE_MS = 2_000;
/** Internal retries when a concurrent writer wins the optimistic version check. */
export const MAX_CAS_ATTEMPTS = 3;
/** Sessions with fewer players are practice: never ranked, never on leaderboards. */
export const MIN_RANKED_PLAYERS = 2;
export const ABANDON_REASON_MAX = 200;
export const LEADERBOARD_MAX = 100;
export const LEADERBOARD_DEFAULT = 25;

// ─── Job types (non-Discord)
export const GAMES_TICK_JOB = 'games.tick';
export const GAMES_SWEEP_JOB = 'games.sweep';
