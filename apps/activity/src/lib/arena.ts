import type { ArenaResponse, ArenaSessionWire, TriviaViewWire } from '../api/contract';

/** Poll cadence while a game is live, and while nothing is (lobby discovery, podium). */
export const LIVE_POLL_MS = 1_000;
export const IDLE_POLL_MS = 3_000;
/** Backoff after failed polls: 1 s, 2 s, 4 s … capped. */
export const MAX_BACKOFF_MS = 8_000;
/**
 * The server only lets players advance a transition that is ≥ 2 s overdue
 * (the worker normally does it on time). Wait that long, plus network slack,
 * before nudging.
 */
export const TICK_AFTER_OVERDUE_MS = 2_250;
export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

export function isLive(session: ArenaSessionWire | null): boolean {
  return session !== null && (session.status === 'lobby' || session.status === 'active');
}

/** The next instant the game changes on its own: question close or reveal end. */
export function nextDeadline(view: TriviaViewWire | null): number | null {
  if (!view) return null;
  if (view.phase === 'question') return view.closesAt;
  if (view.phase === 'reveal') return view.revealUntil;
  return null;
}

/** Players and the host may nudge overdue timers; spectators only watch. */
export function shouldTick(session: ArenaSessionWire | null, serverNow: number): boolean {
  if (!session || session.status !== 'active') return false;
  if (!session.youArePlayer && !session.isHost) return false;
  const deadline = nextDeadline(session.trivia);
  return deadline !== null && serverNow >= deadline + TICK_AFTER_OVERDUE_MS;
}

export function pollDelay(session: ArenaSessionWire | null, failures: number): number {
  if (failures > 0) return Math.min(MAX_BACKOFF_MS, LIVE_POLL_MS * 2 ** (failures - 1));
  return isLive(session) ? LIVE_POLL_MS : IDLE_POLL_MS;
}

/**
 * Responses can arrive out of order (a poll racing an answer). Keep the newer
 * view of the same session; a different session always replaces the old one.
 */
export function newerResponse(current: ArenaResponse | null, next: ArenaResponse): ArenaResponse {
  const a = current?.session;
  const b = next.session;
  if (a && b && a.id === b.id && b.version < a.version) {
    return { ...current!, serverNow: next.serverNow, liveSessionId: next.liveSessionId };
  }
  return next;
}

/** Remaining fraction of the current window (1 → full ring, 0 → empty). */
export function remainingFraction(view: TriviaViewWire, serverNow: number): number {
  const end = nextDeadline(view);
  if (end === null) return 0;
  const start = view.phase === 'question' ? view.openedAt : view.closesAt;
  if (start === null || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - serverNow) / (end - start)));
}

export function secondsLeft(view: TriviaViewWire, serverNow: number): number {
  const end = nextDeadline(view);
  return end === null ? 0 : Math.max(0, Math.ceil((end - serverNow) / 1000));
}

export interface PodiumSpot {
  key: string;
  displayName: string;
  score: number;
  placement: number;
  isYou: boolean;
}

/** Final standings from the completed session (placements are shared on ties). */
export function standings(session: ArenaSessionWire): PodiumSpot[] {
  return session.players
    .filter((player) => player.placement !== null)
    .map((player) => ({
      key: player.key,
      displayName: player.displayName,
      score: player.score ?? 0,
      placement: player.placement!,
      isYou: player.isYou,
    }))
    .sort((a, b) => a.placement - b.placement || b.score - a.score || a.key.localeCompare(b.key));
}

export type ArenaStage =
  | 'none'
  | 'lobby'
  | 'question'
  | 'reveal'
  | 'starting'
  | 'completed'
  | 'abandoned';

export function stageOf(session: ArenaSessionWire | null): ArenaStage {
  if (!session) return 'none';
  switch (session.status) {
    case 'lobby':
      return 'lobby';
    case 'completed':
      return 'completed';
    case 'abandoned':
      return 'abandoned';
    case 'active': {
      const phase = session.trivia?.phase;
      if (phase === 'question') return 'question';
      if (phase === 'reveal' || phase === 'finished') return 'reveal';
      return 'starting';
    }
  }
}
