import { games } from '@jave/core';
import type {
  ArenaSessionWire,
  TriviaConfigWire,
  TriviaScoreWire,
  TriviaViewWire,
} from '../contract';

type SessionView = games.SessionView;
type TriviaPublicView = games.trivia.TriviaPublicView;

/** Players are keyed by seat, so the Activity never sees account ids. */
const playerKey = (index: number): string => `p${index + 1}`;
const UNKNOWN_PLAYER = 'Former player';

function isTriviaView(view: unknown): view is TriviaPublicView {
  return (
    typeof view === 'object' &&
    view !== null &&
    (view as { game?: unknown }).game === games.trivia.TRIVIA_KEY
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toConfig(config: Record<string, unknown>): TriviaConfigWire {
  return {
    rounds: numberOr(config.rounds, games.trivia.TRIVIA_DEFAULT_ROUNDS),
    secondsPerQuestion: numberOr(config.secondsPerQuestion, games.trivia.TRIVIA_DEFAULT_SECONDS),
    difficulty: typeof config.difficulty === 'string' ? config.difficulty : 'mixed',
  };
}

function toTrivia(
  view: TriviaPublicView,
  names: ReadonlyMap<string, { key: string; displayName: string }>,
  viewerUserId: string,
): TriviaViewWire {
  const scoreboard = view.scoreboard.map((entry): TriviaScoreWire => {
    const player = names.get(entry.playerId);
    return {
      playerKey: player?.key ?? 'p0',
      displayName: player?.displayName ?? UNKNOWN_PLAYER,
      isYou: entry.playerId === viewerUserId,
      score: entry.score,
      placement: entry.placement,
      answered: entry.answered,
      correct: entry.correct,
    };
  });
  return {
    phase: view.phase,
    round: view.round,
    totalRounds: view.totalRounds,
    secondsPerQuestion: view.secondsPerQuestion,
    openedAt: view.openedAt,
    closesAt: view.closesAt,
    revealUntil: view.revealUntil,
    question: view.question
      ? {
          prompt: view.question.prompt,
          options: [...view.question.options],
          category: view.question.category,
          difficulty: view.question.difficulty,
        }
      : null,
    correctIndex: view.correctIndex,
    fact: view.fact,
    answeredCount: view.answeredCount,
    playerCount: view.playerCount,
    scoreboard,
    you: view.you
      ? {
          answered: view.you.answered,
          choice: view.you.choice,
          correct: view.you.correct,
          points: view.you.points,
        }
      : null,
  };
}

/**
 * The viewer's Arena view of a session: core's public view (already stripped
 * of answers until the reveal) with account ids replaced by seat keys and
 * the host reduced to an `isHost` flag.
 */
export function toArenaSession(session: SessionView, viewerUserId: string): ArenaSessionWire {
  const names = new Map(
    session.players.map((player, index) => [
      player.userId,
      { key: playerKey(index), displayName: player.displayName },
    ]),
  );
  const isHost = session.hostUserId === viewerUserId;
  const seats = session.players.length;
  const lobby = session.status === 'lobby';
  return {
    id: session.id,
    status: session.status,
    version: session.version,
    gameName: session.gameName,
    isHost,
    youArePlayer: session.youArePlayer,
    canStart: lobby && isHost && seats >= session.minPlayers && seats <= session.maxPlayers,
    canJoin: lobby && !session.youArePlayer && seats < session.maxPlayers,
    practice: seats < games.MIN_RANKED_PLAYERS,
    minPlayers: session.minPlayers,
    maxPlayers: session.maxPlayers,
    config: toConfig(session.config),
    players: session.players.map((player, index) => ({
      key: playerKey(index),
      displayName: player.displayName,
      isYou: player.userId === viewerUserId,
      isHost: player.userId === session.hostUserId,
      score: player.score,
      placement: player.placement,
    })),
    trivia: isTriviaView(session.view) ? toTrivia(session.view, names, viewerUserId) : null,
    endReason: session.endReason,
  };
}
