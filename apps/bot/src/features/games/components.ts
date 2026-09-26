import { actorUserId, can, games, isUuid } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ComponentHandler, HandlerContext } from '../../interactions/types';
import { button, failure, panel, row, success } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { CONFIRM, GAME_ACTION, GAMES_NS, OPTION_LETTERS, STAFF_OVERRIDE, TAP } from './constants';
import { gameKeyOf, metricOf, showLeaderboard } from './leaderboard';
import { isReactionView, isTriviaView } from './views';

/** Round numbers in custom ids: a few digits, nothing else (core checks the actual round). */
const ROUND_ARG = /^\d{1,3}$/;
/** A TRIVIA option index in a custom id. */
const CHOICE_ARG = /^\d$/;

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

/** The move a button stands for; null for anything a panel never renders. */
export function moveFrom(
  round: string | undefined,
  choice: string | undefined,
): Record<string, unknown> | null {
  if (!round || !ROUND_ARG.test(round)) return null;
  const roundNumber = Number(round);
  if (roundNumber < 1) return null;
  if (choice === TAP) return { round: roundNumber, action: TAP };
  if (choice !== undefined && CHOICE_ARG.test(choice)) {
    return { round: roundNumber, choice: Number(choice) };
  }
  return null;
}

/** A move as the clicking player. The reply is private and never reveals correctness early. */
async function submit(
  h: HandlerContext,
  sessionId: string,
  move: Record<string, unknown>,
): Promise<void> {
  const result = await games.submitMove(h.ctx, { sessionId, move });
  const view = result.view.view;
  if (isReactionView(view) && view.you?.falseStart) {
    await h.respond({
      embeds: [failure('FALSE START', 'You tapped before GO. This round scores nothing for you.')],
      ephemeral: true,
    });
    return;
  }
  const choice = isTriviaView(view) ? view.you?.choice : null;
  const title =
    choice !== null && choice !== undefined
      ? `Answer locked ${GLYPH.dot} ${OPTION_LETTERS[choice] ?? String(choice + 1)}`
      : 'Tap recorded';
  await h.respond({
    embeds: [success(title, `Round ${result.round}. Results appear at the reveal.`)],
    ephemeral: true,
  });
}

async function join(h: HandlerContext, sessionId: string): Promise<void> {
  const view = await games.joinSession(h.ctx, { sessionId });
  await h.respond({
    embeds: [
      success(
        `Joined ${GLYPH.dot} ${view.gameName.toUpperCase()}`,
        `${view.players.length} / ${view.maxPlayers} players. The host starts the game.`,
      ),
    ],
    ephemeral: true,
  });
}

async function leave(h: HandlerContext, sessionId: string): Promise<void> {
  const view = await games.leaveSession(h.ctx, { sessionId });
  await h.respond({
    embeds: [
      success(
        'Left the lobby',
        view.status === 'abandoned' ? 'You were the last player; the lobby is closed.' : undefined,
      ),
    ],
    ephemeral: true,
  });
}

async function start(h: HandlerContext, sessionId: string): Promise<void> {
  const view = await games.startSession(h.ctx, { sessionId });
  const players = `${view.players.length} ${view.players.length === 1 ? 'player' : 'players'}`;
  const practice =
    view.players.length < games.MIN_RANKED_PLAYERS
      ? ' Solo sessions are practice, not ranked.'
      : '';
  await h.respond({
    embeds: [
      success(
        `Started ${GLYPH.dot} ${view.gameName.toUpperCase()}`,
        `${players}. The first round is live on the panel.${practice}`,
      ),
    ],
    ephemeral: true,
  });
}

/**
 * Stopping a game is final, so it is confirmed first. The prompt is only
 * offered to the host and event staff; core re-authorizes the confirmation.
 */
export async function promptStop(h: HandlerContext, sessionId: string): Promise<void> {
  const view = await games.getSessionView(h.ctx, { sessionId });
  const host = actorUserId(h.ctx.actor) === view.hostUserId;
  if (!host && !can(h.ctx, STAFF_OVERRIDE)) {
    await h.respond({
      embeds: [failure('ACCESS RESTRICTED', 'Only the host or event staff can stop this game.')],
      ephemeral: true,
    });
    return;
  }
  if (view.status !== 'lobby' && view.status !== 'active') {
    await h.respond({
      embeds: [failure('NOT AVAILABLE RIGHT NOW', 'This game has already ended.')],
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [
      panel({
        title: `Stop ${view.gameName}?`,
        description: 'The game ends for everyone. No results are recorded.',
      }),
    ],
    components: [
      row(
        button('Stop game', customId(GAMES_NS, GAME_ACTION.abandon, sessionId, CONFIRM), 'danger'),
      ),
    ],
    ephemeral: true,
  });
}

async function stop(h: HandlerContext, sessionId: string): Promise<void> {
  await games.abandonSession(h.ctx, { sessionId });
  await h.interaction.update({
    embeds: [success('Game stopped', 'No results are recorded for a stopped game.')],
    components: [],
  });
}

async function handle(h: HandlerContext, action: string, args: readonly string[]): Promise<void> {
  if (action === GAME_ACTION.board) {
    const [gameKey, metric] = [gameKeyOf(args[0] ?? ''), metricOf(args[1] ?? '')];
    if (!gameKey || !metric) return expired(h);
    return showLeaderboard(h, gameKey, metric, { update: true });
  }
  if (action === GAME_ACTION.boardGame) {
    const [gameKey, metric] = [gameKeyOf(h.interaction.values[0] ?? ''), metricOf(args[0] ?? '')];
    if (!gameKey || !metric) return expired(h);
    return showLeaderboard(h, gameKey, metric, { update: true });
  }
  const sessionId = args[0];
  if (!sessionId || !isUuid(sessionId)) return expired(h);
  switch (action) {
    case GAME_ACTION.join:
      return join(h, sessionId);
    case GAME_ACTION.leave:
      return leave(h, sessionId);
    case GAME_ACTION.start:
      return start(h, sessionId);
    case GAME_ACTION.abandon:
      return args[1] === CONFIRM ? stop(h, sessionId) : promptStop(h, sessionId);
    case GAME_ACTION.move: {
      const move = moveFrom(args[1], args[2]);
      if (move === null) return expired(h);
      return submit(h, sessionId, move);
    }
    default:
      return expired(h);
  }
}

/** Lobby and play buttons. Custom ids route; core authorizes the clicking user every time. */
export const gameComponents: ComponentHandler = { namespace: GAMES_NS, handle };
