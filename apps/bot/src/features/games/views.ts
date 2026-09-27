import { games } from '@jave/core';

export type TriviaView = games.trivia.TriviaPublicView;
export type ReactionView = games.reaction.ReactionPublicView;

/** `SessionView.view` is game-specific and typed `unknown`; these narrow it by its `game` key. */
export function isTriviaView(view: unknown): view is TriviaView {
  return (
    typeof view === 'object' &&
    view !== null &&
    'game' in view &&
    view.game === games.trivia.TRIVIA_KEY
  );
}

export function isReactionView(view: unknown): view is ReactionView {
  return (
    typeof view === 'object' &&
    view !== null &&
    'game' in view &&
    view.game === games.reaction.REACTION_KEY
  );
}
