import type { z } from 'zod';
import type { Rng } from './rng';

/** Why a move was refused; the session service maps each code to a JaveError. */
export type MoveRejection = 'not_player' | 'closed' | 'wrong_round' | 'duplicate' | 'invalid';

export type MoveValidation = { ok: true } | { ok: false; code: MoveRejection; reason: string };

export interface AppliedMove<State> {
  state: State;
  /** The round the move belongs to. The platform persists one move per player per round. */
  round: number;
  /** Correctness when the game has that notion. Stored for audit, never shown before the reveal. */
  correct: boolean | null;
  points: number;
}

/**
 * A game engine. Engines are pure and deterministic:
 * - no I/O, no clock reads, no Math.random — time arrives as `now` (epoch ms)
 *   and randomness only through the seeded `rng` given to `init`;
 * - state is JSON-serializable (stored as jsonb): plain objects, arrays,
 *   strings, finite numbers, booleans and null — never Dates, Maps or
 *   undefined — and logic never depends on object key order (jsonb reorders);
 * - `advance` returns the same object when nothing is due, so the platform
 *   can skip writes;
 * - `publicView` is the only thing players ever see: it must not leak hidden
 *   information (answers before the reveal, future rounds, other players'
 *   choices, upcoming timers the players should not know).
 *
 * The session service owns everything else: persistence, optimistic
 * concurrency, authorization, timers (via `nextDeadline`), placements and
 * domain events.
 */
export interface GameDefinition<Config, State, Move, PublicState> {
  /** Stable id stored on sessions, ≤ 32 chars, lowercase. */
  key: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  configSchema: z.ZodType<Config>;
  moveSchema: z.ZodType<Move>;
  /** Build the initial state. The platform calls `advance(state, now)` right after. */
  init(config: Config, players: readonly string[], rng: Rng): State;
  validateMove(state: State, player: string, move: Move, now: number): MoveValidation;
  /** Only called after `validateMove` accepted the move against the same state and time. */
  applyMove(state: State, player: string, move: Move, now: number): AppliedMove<State>;
  /** Apply every timer transition due at `now`. */
  advance(state: State, now: number): State;
  /** Next instant at which `advance` would change the state; null when nothing is scheduled. */
  nextDeadline(state: State): number | null;
  isFinished(state: State): boolean;
  /** Current committed score per player id. */
  scores(state: State): Readonly<Record<string, number>>;
  /** What `viewerId` may see (null = spectator). */
  publicView(state: State, viewerId: string | null): PublicState;
}

/** A registered definition with its types erased; the registry and services use this. */
export type AnyGameDefinition = GameDefinition<unknown, unknown, unknown, unknown>;

export interface GameSummary {
  key: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
}
