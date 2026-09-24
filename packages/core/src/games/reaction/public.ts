// Public surface of REACTION for other packages. Engine state (with the secret
// GO delays) stays internal.
export {
  REACTION_KEY,
  REACTION_MIN_ROUNDS,
  REACTION_MAX_ROUNDS,
  REACTION_DEFAULT_ROUNDS,
  REACTION_MIN_PLAYERS,
  REACTION_MAX_PLAYERS,
  REACTION_WINDOW_MS,
  REACTION_REVEAL_MS,
  reactionConfigSchema,
  reactionMoveSchema,
  type ReactionConfig,
  type ReactionMove,
  type ReactionPhase,
  type ReactionPublicView,
} from './reaction';
