import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { gamePlayers, gameSessions, members } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { requireViewer } from '../calendar/guards';
import { MIN_RANKED_PLAYERS } from './constants';
import { getGame } from './registry';
import { leaderboardSchema } from './schemas';

export type LeaderboardMetric = 'wins' | 'best_score' | 'sessions';

export interface LeaderboardEntry {
  /** Competition rank on the chosen metric (ties share a rank). */
  rank: number;
  memberId: string;
  handle: string;
  displayName: string;
  wins: number;
  bestScore: number;
  sessions: number;
}

export interface Leaderboard {
  gameKey: string;
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
}

/**
 * Per-game leaderboard over ranked sessions (two or more players; solo
 * practice never counts). Only members who opted in via showOnLeaderboards,
 * in good standing and not deleted, appear. Game stats are just that — they
 * are never capability.
 */
export async function getLeaderboard(
  ctx: ServiceContext,
  input: z.input<typeof leaderboardSchema>,
): Promise<Leaderboard> {
  requireViewer(ctx);
  const q = parseInput(leaderboardSchema, input);
  const game = getGame(q.gameKey);
  const wins = sql<number>`count(*) filter (where ${gamePlayers.placement} = 1)::int`;
  const bestScore = sql<number>`max(${gamePlayers.score})::int`;
  const sessions = sql<number>`count(*)::int`;
  const metric = { wins, best_score: bestScore, sessions }[q.metric];
  const rows = await ctx.db
    .select({
      memberId: members.id,
      handle: members.handle,
      displayName: members.displayName,
      wins,
      bestScore,
      sessions,
    })
    .from(gamePlayers)
    .innerJoin(gameSessions, eq(gameSessions.id, gamePlayers.sessionId))
    .innerJoin(members, eq(members.userId, gamePlayers.userId))
    .where(
      and(
        eq(gameSessions.gameKey, game.key),
        eq(gameSessions.status, 'completed'),
        gte(gameSessions.playerCount, MIN_RANKED_PLAYERS),
        eq(members.showOnLeaderboards, true),
        eq(members.standing, 'good'),
        isNull(members.deletedAt),
      ),
    )
    .groupBy(members.id, members.handle, members.displayName)
    .orderBy(desc(metric), desc(wins), desc(bestScore), asc(members.displayName), asc(members.id))
    .limit(q.limit);

  const value = (row: (typeof rows)[number]) =>
    q.metric === 'wins' ? row.wins : q.metric === 'best_score' ? row.bestScore : row.sessions;
  const entries: LeaderboardEntry[] = [];
  rows.forEach((row, index) => {
    const previous = entries[index - 1];
    const rank = previous && value(rows[index - 1]!) === value(row) ? previous.rank : index + 1;
    entries.push({ rank, ...row });
  });
  return { gameKey: game.key, metric: q.metric, entries };
}
