import 'server-only';
import { games } from '@jave/core';
import { authenticate } from '../auth';
import type { ArenaBoardResponse } from '../contract';
import { activityHandler } from '../handler';
import { json } from '../http';
import { spendActivityBudget } from '../limits';
import { toBoardEntry } from '../mappers/arena';

/** The Arena shows the top of the board; the dashboard's /games page has the full list. */
export const ARENA_BOARD_SIZE = 10;

/**
 * GET /api/activity/trivia/leaderboard — the all-time trivia board by wins,
 * as core's getLeaderboard shows it to this viewer (audience `viewer`: the
 * Activity is the member's own screen, like the dashboard). Core applies every
 * rule — ranked games only, opt-in, good standing, and never a profile the
 * viewer could not open — so a hidden player never appears and leaves no gap.
 */
export const handleArenaBoard = activityHandler(
  'activity.arena.board',
  async (request, deps, base) => {
    const { ctx } = await authenticate(request, deps, base);
    await spendActivityBudget(ctx, 'board', ctx.actor.userId);
    const board = await games.getLeaderboard(ctx, {
      gameKey: games.trivia.TRIVIA_KEY,
      metric: 'wins',
      limit: ARENA_BOARD_SIZE,
      audience: 'viewer',
    });
    return json<ArenaBoardResponse>({
      serverNow: ctx.clock.now().getTime(),
      gameName: games.getGame(board.gameKey).name,
      entries: board.entries.map((entry) => toBoardEntry(entry, ctx.actor.memberId)),
    });
  },
);
