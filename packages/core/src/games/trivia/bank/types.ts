export const TRIVIA_CATEGORIES = [
  'logic',
  'mathematics',
  'physics',
  'computer_science',
  'engineering_history',
  'space',
  'biology',
] as const;
export type TriviaCategory = (typeof TRIVIA_CATEGORIES)[number];

export const TRIVIA_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type TriviaDifficulty = (typeof TRIVIA_DIFFICULTIES)[number];

/**
 * A curated question. Exactly one correct answer and three distractors; the
 * engine shuffles all four per session with the session seed. `fact` is a
 * one-line explanation shown when the round closes.
 */
export interface TriviaQuestion {
  id: string;
  category: TriviaCategory;
  difficulty: TriviaDifficulty;
  prompt: string;
  correct: string;
  distractors: readonly [string, string, string];
  fact: string;
}
