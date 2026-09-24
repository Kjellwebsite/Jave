// Public surface of TRIVIA for other packages (bot rendering, dashboard, Activity).
// Deliberately excludes the question bank and the engine state types: the bank
// holds the answers and must never reach a client bundle.
export {
  TRIVIA_KEY,
  TRIVIA_MIN_ROUNDS,
  TRIVIA_MAX_ROUNDS,
  TRIVIA_DEFAULT_ROUNDS,
  TRIVIA_MIN_SECONDS,
  TRIVIA_MAX_SECONDS,
  TRIVIA_DEFAULT_SECONDS,
  TRIVIA_MIN_PLAYERS,
  TRIVIA_MAX_PLAYERS,
  TRIVIA_BASE_POINTS,
  TRIVIA_MAX_SPEED_BONUS,
  TRIVIA_REVEAL_MS,
  triviaConfigSchema,
  triviaMoveSchema,
  type TriviaConfig,
  type TriviaMove,
  type TriviaPhase,
  type TriviaPublicView,
  type TriviaScoreboardEntry,
} from './trivia';
export {
  TRIVIA_CATEGORIES,
  TRIVIA_DIFFICULTIES,
  type TriviaCategory,
  type TriviaDifficulty,
} from './bank/types';
