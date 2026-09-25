import { BIOLOGY_QUESTIONS } from './biology';
import { COMPUTER_SCIENCE_QUESTIONS } from './computer-science';
import { ENGINEERING_HISTORY_QUESTIONS } from './engineering-history';
import { LOGIC_QUESTIONS } from './logic';
import { MATHEMATICS_QUESTIONS } from './mathematics';
import { PHYSICS_QUESTIONS } from './physics';
import { SPACE_QUESTIONS } from './space';
import type { TriviaCategory, TriviaDifficulty, TriviaQuestion } from './types';

export * from './types';

/** The curated JAVELIN trivia bank. Original questions; see the tests for the invariants. */
export const TRIVIA_QUESTIONS: readonly TriviaQuestion[] = [
  ...LOGIC_QUESTIONS,
  ...MATHEMATICS_QUESTIONS,
  ...PHYSICS_QUESTIONS,
  ...COMPUTER_SCIENCE_QUESTIONS,
  ...ENGINEERING_HISTORY_QUESTIONS,
  ...SPACE_QUESTIONS,
  ...BIOLOGY_QUESTIONS,
];

export interface QuestionFilter {
  categories?: readonly TriviaCategory[];
  difficulty: TriviaDifficulty | 'mixed';
}

/** Questions matching the filter, in bank order (the engine shuffles). */
export function questionPool(filter: QuestionFilter): TriviaQuestion[] {
  return TRIVIA_QUESTIONS.filter(
    (question) =>
      (!filter.categories || filter.categories.includes(question.category)) &&
      (filter.difficulty === 'mixed' || question.difficulty === filter.difficulty),
  );
}
