import { actorUserId, can, games, isUuid } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { ComponentHandler, HandlerContext } from '../../interactions/types';
import { button, failure, panel, row, success } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { GAME_ACTION, GAMES_NS, OPTION_LETTERS, TAP } from './constants';

const CONFIRM = 'confirm';
const MAX_ROUND = 1000;

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

function moveFrom(round: string | undefined, choice: string | undefined): unknown {
  const roundNumber = Number(round);
  if (!Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > MAX_ROUND) return null;
  if (choice === TAP) return { round: roundNumber, action: TAP };
  if (choice !== undefined && /^\d$/.test(choice)) return { round: roundNumber, choice: Number(choice) };
  return null;
}

function isTriviaView(view: unknown): view is games.trivia.TriviaPublicView {
  return typeof view === 'object' && view !== null && 'game' in view && view.game === games.trivia.TRIVIA_KEY;
}

function isReactionView(view: unknown): view is games.reaction.ReactionPublicView {
  return (
    typeof view === 'object' &&
    view !== null &&
    'game' in view &&
    view.game === games.reaction.REACTION_KEY
  );
}

/** A move as the clicking player. The reply is private and never reveals correctness early. */
async function submit(h: HandlerContext, sessionId: string, move: unknown): Promise<void> {
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
      ? `Answer locked ${GLYPH.dot} ${OPTION_LETTERS[choice] ?? choice + 1}`
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
  await h.respond({
    embeds: [
      success(
        `Started ${GLYPH.dot} ${view.gameName.toUpperCase()}`,
        `${view.players.length} ${view.players.length === 1 ? 'player' : 'players'}. The first round is live on the panel.`,
      ),
    ],
    ephemeral: true,
  });
}

/** Stopping a game is final, so the host confirms it first. */
async function abandon(h: HandlerContext, sessionId: string, confirmed: boolean): Promise<void> {
  if (confirmed) {
    await games.abandonSession(h.ctx, { sessionId });
    await h.interaction.update({
      embeds: [success('Game stopped', 'No results are recorded for an abandoned game.')],
      components: [],
    });
    return;
  }
  const view = await games.getSessionView(h.ctx, { sessionId });
  if (actorUserId(h.ctx.actor) !== view.hostUserId && !can(h.ctx, 'canManageEvents')) {
    await h.respond({
      embeds: [failure('ACCESS RESTRICTED', 'Only the host or event staff can stop this game.')],
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [
      panel({
        title: `Stop ${view.gameName}?`,
        description: 'The game ends for everyone and no results are recorded.',
      }),
    ],
    components: [
      row(button('Stop game', customId(GAMES_NS, GAME_ACTION.abandon, sessionId, CONFIRM), 'danger')),
    ],
    ephemeral: true,
  });
}

async function handle(h: HandlerContext, action: string, args: readonly string[]): Promise<void> {
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
      return abandon(h, sessionId, args[1] === CONFIRM);
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
