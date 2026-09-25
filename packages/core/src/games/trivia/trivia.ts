import { z } from 'zod';
import { rankPlacements } from '../placements';
import type { AppliedMove, GameDefinition, MoveRejection, MoveValidation } from '../types';
import {
  questionPool,
  TRIVIA_CATEGORIES,
  TRIVIA_DIFFICULTIES,
  type TriviaCategory,
  type TriviaDifficulty,
} from './bank';

export const TRIVIA_KEY = 'trivia';
export const TRIVIA_MIN_ROUNDS = 5;
export const TRIVIA_MAX_ROUNDS = 15;
export const TRIVIA_DEFAULT_ROUNDS = 10;
export const TRIVIA_MIN_SECONDS = 10;
export const TRIVIA_MAX_SECONDS = 30;
export const TRIVIA_DEFAULT_SECONDS = 20;
export const TRIVIA_MIN_PLAYERS = 1;
export const TRIVIA_MAX_PLAYERS = 25;
/** Points for a correct answer, plus up to the speed bonus for answering early. */
export const TRIVIA_BASE_POINTS = 100;
export const TRIVIA_MAX_SPEED_BONUS = 50;
/** How long the answer stays on screen before the next question. */
export const TRIVIA_REVEAL_MS = 5_000;
const OPTIONS_PER_QUESTION = 4;
const MS_PER_SECOND = 1000;
/** Guards `advance` against a transition loop; a full game needs far fewer steps per call. */
const MAX_ADVANCE_STEPS = 64;

export const triviaConfigSchema = z
  .object({
    rounds: z
      .number()
      .int()
      .min(TRIVIA_MIN_ROUNDS)
      .max(TRIVIA_MAX_ROUNDS)
      .default(TRIVIA_DEFAULT_ROUNDS),
    secondsPerQuestion: z
      .number()
      .int()
      .min(TRIVIA_MIN_SECONDS)
      .max(TRIVIA_MAX_SECONDS)
      .default(TRIVIA_DEFAULT_SECONDS),
    categories: z
      .array(z.enum(TRIVIA_CATEGORIES))
      .min(1)
      .max(TRIVIA_CATEGORIES.length)
      .refine((list) => new Set(list).size === list.length, 'categories must be unique')
      .optional(),
    difficulty: z.enum([...TRIVIA_DIFFICULTIES, 'mixed']).default('mixed'),
  })
  .strict()
  .superRefine((config, ctx) => {
    const available = questionPool(config).length;
    if (available < config.rounds) {
      ctx.addIssue({
        code: 'custom',
        path: ['rounds'],
        message: `only ${available} questions match these filters`,
      });
    }
  });
export type TriviaConfig = z.infer<typeof triviaConfigSchema>;

export const triviaMoveSchema = z
  .object({
    round: z.number().int().min(1).max(TRIVIA_MAX_ROUNDS),
    choice: z
      .number()
      .int()
      .min(0)
      .max(OPTIONS_PER_QUESTION - 1),
  })
  .strict();
export type TriviaMove = z.infer<typeof triviaMoveSchema>;

export interface TriviaRound {
  questionId: string;
  category: TriviaCategory;
  difficulty: TriviaDifficulty;
  prompt: string;
  options: string[];
  correctIndex: number;
  fact: string;
}

export interface TriviaAnswer {
  choice: number;
  at: number;
  correct: boolean;
  points: number;
}

export type TriviaPhase = 'pending' | 'question' | 'reveal' | 'finished';

export interface TriviaState {
  players: string[];
  secondsPerQuestion: number;
  rounds: TriviaRound[];
  /** 1-based current round; 0 before the first question opens. */
  round: number;
  phase: TriviaPhase;
  openedAt: number | null;
  closesAt: number | null;
  revealUntil: number | null;
  /** answers[round − 1][playerId] */
  answers: Record<string, TriviaAnswer>[];
  /** Committed scores: a round's points count only once it closes. */
  scores: Record<string, number>;
}

export interface TriviaScoreboardEntry {
  playerId: string;
  score: number;
  placement: number;
  answered: boolean;
  /** Null until the round closes. */
  correct: boolean | null;
}

export interface TriviaPublicView {
  game: typeof TRIVIA_KEY;
  phase: TriviaPhase;
  round: number;
  totalRounds: number;
  secondsPerQuestion: number;
  openedAt: number | null;
  closesAt: number | null;
  revealUntil: number | null;
  question: {
    prompt: string;
    options: string[];
    category: TriviaCategory;
    difficulty: TriviaDifficulty;
  } | null;
  /** Null while the question is open. */
  correctIndex: number | null;
  fact: string | null;
  answeredCount: number;
  playerCount: number;
  scoreboard: TriviaScoreboardEntry[];
  you: {
    answered: boolean;
    choice: number | null;
    correct: boolean | null;
    points: number | null;
  } | null;
}

/** 100 for a correct answer plus a linear speed bonus of up to 50; 0 otherwise. */
export function triviaPoints(
  correct: boolean,
  answeredAt: number,
  openedAt: number,
  closesAt: number,
): number {
  if (!correct) return 0;
  const window = Math.max(1, closesAt - openedAt);
  const remaining = Math.min(window, Math.max(0, closesAt - answeredAt));
  return TRIVIA_BASE_POINTS + Math.round((TRIVIA_MAX_SPEED_BONUS * remaining) / window);
}

const reject = (code: MoveRejection, reason: string): MoveValidation => ({
  ok: false,
  code,
  reason,
});

function openRound(state: TriviaState, round: number, now: number): TriviaState {
  return {
    ...state,
    round,
    phase: 'question',
    openedAt: now,
    closesAt: now + state.secondsPerQuestion * MS_PER_SECOND,
    revealUntil: null,
  };
}

function closeRound(state: TriviaState, now: number): TriviaState {
  const answers = state.answers[state.round - 1] ?? {};
  const scores = { ...state.scores };
  for (const player of state.players) {
    if (Object.hasOwn(answers, player))
      scores[player] = (scores[player] ?? 0) + answers[player]!.points;
  }
  return {
    ...state,
    phase: 'reveal',
    closesAt: Math.min(state.closesAt ?? now, now),
    revealUntil: now + TRIVIA_REVEAL_MS,
    scores,
  };
}

function step(state: TriviaState, now: number): TriviaState {
  switch (state.phase) {
    case 'pending':
      return state.rounds.length === 0 ? { ...state, phase: 'finished' } : openRound(state, 1, now);
    case 'question':
      return now >= state.closesAt! ? closeRound(state, now) : state;
    case 'reveal':
      if (now < state.revealUntil!) return state;
      return state.round < state.rounds.length
        ? openRound(state, state.round + 1, now)
        : { ...state, phase: 'finished', revealUntil: null };
    case 'finished':
      return state;
  }
}

export const trivia: GameDefinition<TriviaConfig, TriviaState, TriviaMove, TriviaPublicView> = {
  key: TRIVIA_KEY,
  name: 'Trivia',
  description:
    'Logic, mathematics, physics, computer science, engineering history, space and biology. Correct answers score 100, plus up to 50 for speed.',
  minPlayers: TRIVIA_MIN_PLAYERS,
  maxPlayers: TRIVIA_MAX_PLAYERS,
  configSchema: triviaConfigSchema,
  moveSchema: triviaMoveSchema,

  init(config, players, rng) {
    const picked = rng.shuffle(questionPool(config)).slice(0, config.rounds);
    const rounds = picked.map((question): TriviaRound => {
      const options = rng.shuffle([question.correct, ...question.distractors]);
      return {
        questionId: question.id,
        category: question.category,
        difficulty: question.difficulty,
        prompt: question.prompt,
        options,
        correctIndex: options.indexOf(question.correct),
        fact: question.fact,
      };
    });
    return {
      players: [...players],
      secondsPerQuestion: config.secondsPerQuestion,
      rounds,
      round: 0,
      phase: 'pending',
      openedAt: null,
      closesAt: null,
      revealUntil: null,
      answers: rounds.map(() => ({})),
      scores: Object.fromEntries(players.map((player) => [player, 0])),
    };
  },

  validateMove(state, player, move, now) {
    if (!state.players.includes(player))
      return reject('not_player', 'You are not playing in this game.');
    if (state.phase !== 'question' || state.closesAt === null || now >= state.closesAt) {
      return reject('closed', 'This round is closed.');
    }
    if (move.round !== state.round) return reject('wrong_round', 'That round is not open.');
    const answers = state.answers[state.round - 1] ?? {};
    if (Object.hasOwn(answers, player))
      return reject('duplicate', 'You already answered this round.');
    const options = state.rounds[state.round - 1]?.options.length ?? 0;
    if (move.choice >= options) return reject('invalid', 'Unknown option.');
    return { ok: true };
  },

  applyMove(state, player, move, now): AppliedMove<TriviaState> {
    const index = state.round - 1;
    const question = state.rounds[index]!;
    const correct = move.choice === question.correctIndex;
    const points = triviaPoints(correct, now, state.openedAt!, state.closesAt!);
    const answers = state.answers.map((entry, i) =>
      i === index
        ? { ...entry, [player]: { choice: move.choice, at: now, correct, points } }
        : entry,
    );
    let next: TriviaState = { ...state, answers };
    // Everyone answered: close early rather than make the room wait.
    if (state.players.every((p) => Object.hasOwn(answers[index]!, p))) next = closeRound(next, now);
    return { state: next, round: state.round, correct, points };
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
    if (state.phase === 'question') return state.closesAt;
    if (state.phase === 'reveal') return state.revealUntil;
    return null;
  },

  isFinished: (state) => state.phase === 'finished',

  scores: (state) => state.scores,

  publicView(state, viewerId) {
    const index = state.round - 1;
    const live = state.phase === 'question' || state.phase === 'reveal';
    const current = live ? state.rounds[index] : undefined;
    const revealed = state.phase === 'reveal';
    const roundAnswers: Record<string, TriviaAnswer> = current ? (state.answers[index] ?? {}) : {};
    const answeredBy = (player: string) => Object.hasOwn(roundAnswers, player);
    const isPlayer = viewerId !== null && state.players.includes(viewerId);
    const mine = isPlayer && answeredBy(viewerId) ? roundAnswers[viewerId] : undefined;
    return {
      game: TRIVIA_KEY,
      phase: state.phase,
      round: state.round,
      totalRounds: state.rounds.length,
      secondsPerQuestion: state.secondsPerQuestion,
      openedAt: live ? state.openedAt : null,
      closesAt: live ? state.closesAt : null,
      revealUntil: revealed ? state.revealUntil : null,
      question: current
        ? {
            prompt: current.prompt,
            options: [...current.options],
            category: current.category,
            difficulty: current.difficulty,
          }
        : null,
      correctIndex: revealed && current ? current.correctIndex : null,
      fact: revealed && current ? current.fact : null,
      answeredCount: state.players.filter(answeredBy).length,
      playerCount: state.players.length,
      scoreboard: rankPlacements(state.players, state.scores).map((entry) => ({
        ...entry,
        answered: answeredBy(entry.playerId),
        correct: revealed
          ? answeredBy(entry.playerId) && roundAnswers[entry.playerId]!.correct
          : null,
      })),
      you: isPlayer
        ? {
            answered: Boolean(mine),
            choice: mine?.choice ?? null,
            correct: revealed && mine ? mine.correct : null,
            points: revealed && mine ? mine.points : null,
          }
        : null,
    };
  },
};
