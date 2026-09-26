import { games } from '@jave/core';

/** Custom-id namespace for every games button and select. */
export const GAMES_NS = 'games';

/** The game a leaderboard shows when none is chosen. */
export const DEFAULT_GAME_KEY = games.trivia.TRIVIA_KEY;

/** Custom-id actions (`games:<action>:<sessionId>…`). They route; core authorizes. */
export const GAME_ACTION = {
  join: 'join',
  leave: 'leave',
  start: 'start',
  abandon: 'abandon',
  move: 'move',
  /** `games:board:<gameKey>:<metric>` — switch a private leaderboard's metric. */
  board: 'board',
  /** `games:board-game:<metric>` + selected game — switch a private leaderboard's game. */
  boardGame: 'board-game',
} as const;

/** The REACTION move argument (TRIVIA moves carry the option index instead). */
export const TAP = 'tap';

/** Second argument of `games:abandon:<id>:confirm`: the confirmed stop. */
export const CONFIRM = 'confirm';

/** Event staff may start or stop any game (core audits it); used only to offer controls. */
export const STAFF_OVERRIDE = 'canManageEvents' as const;

/** Answer letters for TRIVIA's four options. */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** How many scoreboard rows a panel shows (the rest are summarized). */
export const SCOREBOARD_ROWS = 10;
/** How many lobby players are listed by name. */
export const LOBBY_ROWS = 25;
export const LEADERBOARD_ROWS = 15;

export const LEADERBOARD_METRICS = ['wins', 'best_score', 'sessions'] as const;
export type LeaderboardMetricChoice = (typeof LEADERBOARD_METRICS)[number];

export const METRIC_LABEL: Record<LeaderboardMetricChoice, string> = {
  wins: 'Wins',
  best_score: 'Best score',
  sessions: 'Sessions',
};

/** Audit-log reason on Discord for panel clean-up. */
export const RENDER_REASON = 'JAVELIN game panel';
