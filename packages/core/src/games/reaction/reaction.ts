import { z } from 'zod';
import { rankPlacements } from '../placements';
import type { AppliedMove, GameDefinition, MoveRejection, MoveValidation } from '../types';

/**
 * REACTION — the second game, kept deliberately small: it proves the
 * framework handles hidden timers (the GO instant is secret until it
 * happens), a different move shape and false-start anti-cheat. Best on the
 * Activity surface, where the view is pushed without Discord's edit latency.
 */
export const REACTION_KEY = 'reaction';
export const REACTION_MIN_ROUNDS = 3;
export const REACTION_MAX_ROUNDS = 10;
export const REACTION_DEFAULT_ROUNDS = 5;
export const REACTION_MIN_PLAYERS = 1;
export const REACTION_MAX_PLAYERS = 12;
/** GO fires a seeded 1.5–5 s after the round is armed. */
export const REACTION_MIN_DELAY_MS = 1_500;
export const REACTION_DELAY_SPREAD_MS = 3_500;
/** Players have this long after GO to tap. */
export const REACTION_WINDOW_MS = 3_000;
export const REACTION_REVEAL_MS = 3_000;
export const REACTION_MAX_POINTS = 100;
export const REACTION_MIN_POINTS = 10;
/** One point lost per this many milliseconds of reaction time. */
export const REACTION_MS_PER_POINT = 20;
const MAX_ADVANCE_STEPS = 64;

export const reactionConfigSchema = z
  .object({
    rounds: z
      .number()
      .int()
      .min(REACTION_MIN_ROUNDS)
      .max(REACTION_MAX_ROUNDS)
      .default(REACTION_DEFAULT_ROUNDS),
  })
  .strict();
export type ReactionConfig = z.infer<typeof reactionConfigSchema>;

export const reactionMoveSchema = z
  .object({ round: z.number().int().min(1).max(REACTION_MAX_ROUNDS), action: z.literal('tap') })
  .strict();
export type ReactionMove = z.infer<typeof reactionMoveSchema>;

export interface ReactionTap {
  at: number;
  falseStart: boolean;
  reactionMs: number | null;
  points: number;
}

export type ReactionPhase = 'pending' | 'wait' | 'go' | 'reveal' | 'finished';

export interface ReactionState {
  players: string[];
  /** Seeded per-round delay between arming and GO. Secret. */
  delays: number[];
  round: number;
  phase: ReactionPhase;
  /** Secret until reached. */
  goAt: number | null;
  /** The GO instant once it has passed; reaction times are measured from here. */
  wentAt: number | null;
  closesAt: number | null;
  revealUntil: number | null;
  taps: Record<string, ReactionTap>[];
  scores: Record<string, number>;
}

export interface ReactionPublicView {
  game: typeof REACTION_KEY;
  phase: ReactionPhase;
  round: number;
  totalRounds: number;
  wentAt: number | null;
  closesAt: number | null;
  tappedCount: number;
  playerCount: number;
  /** Reaction times, only once the round is revealed. */
  results:
    { playerId: string; reactionMs: number | null; falseStart: boolean; points: number }[] | null;
  scoreboard: { playerId: string; score: number; placement: number }[];
  you: { tapped: boolean; falseStart: boolean | null } | null;
}

export function reactionPoints(reactionMs: number): number {
  return Math.max(
    REACTION_MIN_POINTS,
    REACTION_MAX_POINTS - Math.floor(reactionMs / REACTION_MS_PER_POINT),
  );
}

const reject = (code: MoveRejection, reason: string): MoveValidation => ({
  ok: false,
  code,
  reason,
});

function arm(state: ReactionState, round: number, now: number): ReactionState {
  return {
    ...state,
    round,
    phase: 'wait',
    goAt: now + state.delays[round - 1]!,
    wentAt: null,
    closesAt: null,
    revealUntil: null,
  };
}

function reveal(state: ReactionState, now: number): ReactionState {
  const taps = state.taps[state.round - 1] ?? {};
  const scores = { ...state.scores };
  for (const player of state.players) {
    if (Object.hasOwn(taps, player)) scores[player] = (scores[player] ?? 0) + taps[player]!.points;
  }
  return {
    ...state,
    phase: 'reveal',
    closesAt: now,
    revealUntil: now + REACTION_REVEAL_MS,
    scores,
  };
}

function step(state: ReactionState, now: number): ReactionState {
  switch (state.phase) {
    case 'pending':
      return arm(state, 1, now);
    case 'wait':
      // Reactions are measured from the scheduled GO, never from whoever happened to
      // trigger the transition (a blind tap cannot earn a zero reaction time). The
      // window starts when GO is observed, so a late tick never shortens it.
      return now >= state.goAt!
        ? {
            ...state,
            phase: 'go',
            wentAt: state.goAt,
            closesAt: Math.max(state.goAt!, now) + REACTION_WINDOW_MS,
          }
        : state;
    case 'go':
      return now >= state.closesAt! ? reveal(state, now) : state;
    case 'reveal':
      if (now < state.revealUntil!) return state;
      return state.round < state.delays.length
        ? arm(state, state.round + 1, now)
        : { ...state, phase: 'finished', revealUntil: null };
    case 'finished':
      return state;
  }
}

export const reaction: GameDefinition<
  ReactionConfig,
  ReactionState,
  ReactionMove,
  ReactionPublicView
> = {
  key: REACTION_KEY,
  name: 'Reaction',
  description: 'Wait for GO, then tap. Tap early and the round is lost. Fastest hands score most.',
  minPlayers: REACTION_MIN_PLAYERS,
  maxPlayers: REACTION_MAX_PLAYERS,
  configSchema: reactionConfigSchema,
  moveSchema: reactionMoveSchema,

  init(config, players, rng) {
    const delays = Array.from(
      { length: config.rounds },
      () => REACTION_MIN_DELAY_MS + rng.int(REACTION_DELAY_SPREAD_MS + 1),
    );
    return {
      players: [...players],
      delays,
      round: 0,
      phase: 'pending',
      goAt: null,
      wentAt: null,
      closesAt: null,
      revealUntil: null,
      taps: delays.map(() => ({})),
      scores: Object.fromEntries(players.map((player) => [player, 0])),
    };
  },

  validateMove(state, player, move, now) {
    if (!state.players.includes(player))
      return reject('not_player', 'You are not playing in this game.');
    const open = state.phase === 'wait' || (state.phase === 'go' && now < state.closesAt!);
    if (!open) return reject('closed', 'This round is closed.');
    if (move.round !== state.round) return reject('wrong_round', 'That round is not open.');
    if (Object.hasOwn(state.taps[state.round - 1] ?? {}, player)) {
      return reject('duplicate', 'You already tapped this round.');
    }
    return { ok: true };
  },

  applyMove(state, player, _move, now): AppliedMove<ReactionState> {
    const index = state.round - 1;
    const falseStart = state.phase === 'wait';
    const reactionMs = falseStart ? null : now - state.wentAt!;
    const points = reactionMs === null ? 0 : reactionPoints(reactionMs);
    const taps = state.taps.map((entry, i) =>
      i === index ? { ...entry, [player]: { at: now, falseStart, reactionMs, points } } : entry,
    );
    let next: ReactionState = { ...state, taps };
    // Everyone has tapped (or false-started): nothing left to wait for.
    if (state.players.every((p) => Object.hasOwn(taps[index]!, p))) next = reveal(next, now);
    return { state: next, round: state.round, correct: !falseStart, points };
  },

  advance(state, now) {
    let current = state;
    for (let i = 0; i < MAX_ADVANCE_STEPS; i++) {
      const next = step(current, now);
      if (next === current) return current;
      current = next;
    }
    return current;
  },

  nextDeadline(state) {
    if (state.phase === 'wait') return state.goAt;
    if (state.phase === 'go') return state.closesAt;
    if (state.phase === 'reveal') return state.revealUntil;
    return null;
  },

  isFinished: (state) => state.phase === 'finished',

  scores: (state) => state.scores,

  publicView(state, viewerId) {
    const taps = state.taps[state.round - 1] ?? {};
    const tapped = (player: string) => Object.hasOwn(taps, player);
    const revealed = state.phase === 'reveal';
    const isPlayer = viewerId !== null && state.players.includes(viewerId);
    return {
      game: REACTION_KEY,
      phase: state.phase,
      round: state.round,
      totalRounds: state.delays.length,
      wentAt: state.phase === 'go' || revealed ? state.wentAt : null,
      closesAt: state.phase === 'go' ? state.closesAt : null,
      tappedCount: state.players.filter(tapped).length,
      playerCount: state.players.length,
      results: revealed
        ? state.players.map((playerId) => ({
            playerId,
            reactionMs: tapped(playerId) ? taps[playerId]!.reactionMs : null,
            falseStart: tapped(playerId) && taps[playerId]!.falseStart,
            points: tapped(playerId) ? taps[playerId]!.points : 0,
          }))
        : null,
      scoreboard: rankPlacements(state.players, state.scores),
      you: isPlayer
        ? {
            tapped: tapped(viewerId),
            // Your own false start is yours to know immediately; others' stay hidden until the reveal.
            falseStart: tapped(viewerId) ? taps[viewerId]!.falseStart : null,
          }
        : null,
    };
  },
};
