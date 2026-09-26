/** Custom-id namespace for every games button. */
export const GAMES_NS = 'games';

/** Custom-id actions (`games:<action>:<sessionId>…`). They route; core authorizes. */
export const GAME_ACTION = {
  join: 'join',
  leave: 'leave',
  start: 'start',
  abandon: 'abandon',
  move: 'move',
} as const;

/** The REACTION move argument (TRIVIA moves carry the option index instead). */
export const TAP = 'tap';

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

export const RENDER_REASON = 'JAVELIN game panel';
