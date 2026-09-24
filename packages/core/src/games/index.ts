import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { gamesJobHandlers, gamesRecurringJobs } from './jobs';

// Module: games — an extensible, deterministic game framework (engines +
// sessions + leaderboards) with TRIVIA and REACTION built in.

export * from './constants';
export type {
  GameDefinition,
  AnyGameDefinition,
  GameSummary,
  MoveValidation,
  MoveRejection,
  AppliedMove,
} from './types';
export { createRng, seededShuffle, type Rng } from './rng';
export { rankPlacements } from './placements';
export { registerGame, getGame, findGame, listGames } from './registry';
export {
  availableGames,
  createSession,
  joinSession,
  leaveSession,
  startSession,
  abandonSession,
  getSessionView,
  findLiveSession,
} from './sessions.service';
export { submitMove, tickSession, type MoveResult } from './play.service';
export {
  getLeaderboard,
  type Leaderboard,
  type LeaderboardEntry,
  type LeaderboardMetric,
} from './leaderboard.service';
export {
  DISCORD_GAMES_RENDER_JOB,
  discordGamesRenderPayloadSchema,
  getGameRender,
  markGameMessagePosted,
  markGameChannelUnavailable,
  type DiscordGamesRenderPayload,
  type GameRender,
} from './discord-jobs';
export type { SessionView, SessionPlayerView } from './views';
export type { SessionStatus, SessionSurface } from './records';
export * as trivia from './trivia/public';
export * as reaction from './reaction/public';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = gamesJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = gamesRecurringJobs;
