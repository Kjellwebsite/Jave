import type { ServiceContext } from '../kernel/context';
import { findGame } from './registry';
import {
  loadPlayers,
  type PlayerRow,
  type SessionRecord,
  type SessionStatus,
  type SessionSurface,
} from './records';

export interface SessionPlayerView {
  userId: string;
  memberId: string | null;
  displayName: string;
  /** Final values, set when the session completes. */
  score: number | null;
  placement: number | null;
}

/**
 * A session as a viewer may see it. The engine's `publicView` is the only
 * window into game state — the raw state and the seed never leave core.
 */
export interface SessionView {
  id: string;
  gameKey: string;
  gameName: string;
  status: SessionStatus;
  surface: SessionSurface;
  version: number;
  hostUserId: string;
  minPlayers: number;
  maxPlayers: number;
  players: SessionPlayerView[];
  youArePlayer: boolean;
  config: Record<string, unknown>;
  /** Game-specific public view; null in the lobby. */
  view: unknown;
  startedAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
}

export function toSessionView(
  session: SessionRecord,
  players: readonly PlayerRow[],
  viewerUserId: string | null,
): SessionView {
  const game = findGame(session.gameKey);
  const youArePlayer = viewerUserId !== null && players.some((p) => p.userId === viewerUserId);
  const hasState = session.status !== 'lobby' && Object.keys(session.state).length > 0;
  const completed = session.status === 'completed';
  return {
    id: session.id,
    gameKey: session.gameKey,
    gameName: game?.name ?? session.gameKey,
    status: session.status,
    surface: session.surface,
    version: session.version,
    hostUserId: session.hostUserId,
    minPlayers: game?.minPlayers ?? 0,
    maxPlayers: game?.maxPlayers ?? 0,
    players: players.map((player) => ({
      userId: player.userId,
      memberId: player.memberId,
      displayName: player.displayName,
      score: completed ? player.score : null,
      placement: completed ? player.placement : null,
    })),
    youArePlayer,
    config: session.config,
    view:
      game && hasState ? game.publicView(session.state, youArePlayer ? viewerUserId : null) : null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
  };
}

export async function buildSessionView(
  ctx: ServiceContext,
  session: SessionRecord,
  viewerUserId: string | null,
): Promise<SessionView> {
  return toSessionView(session, await loadPlayers(ctx, session.id), viewerUserId);
}
