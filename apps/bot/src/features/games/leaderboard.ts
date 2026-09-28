import { games, ValidationError } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, panel, row, stringSelect } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import {
  DEFAULT_GAME_KEY,
  GAME_ACTION,
  GAMES_NS,
  LEADERBOARD_METRICS,
  LEADERBOARD_ROWS,
  type LeaderboardMetricChoice,
  METRIC_LABEL,
} from './constants';
import { formatPoints, NAME_MAX, placementLabel } from './format';

const DEFAULT_METRIC: LeaderboardMetricChoice = 'wins';
const LEADERBOARD_FOOTER =
  'Ranked sessions only. Game results are game results — never capability.';

/** A leaderboard metric from an option or custom id; null when it is not one. */
export function metricOf(value: string | null | undefined): LeaderboardMetricChoice | null {
  if (value === null || value === undefined) return DEFAULT_METRIC;
  return LEADERBOARD_METRICS.find((candidate) => candidate === value) ?? null;
}

/** A registered game key; null when no such game exists. */
export function gameKeyOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return DEFAULT_GAME_KEY;
  return games.findGame(value)?.key ?? null;
}

function standingsLines(board: games.Leaderboard): string[] {
  return board.entries.slice(0, LEADERBOARD_ROWS).map((entry) => {
    const stats = [
      `${formatPoints(entry.wins)} ${entry.wins === 1 ? 'win' : 'wins'}`,
      `best ${formatPoints(entry.bestScore)}`,
      `${formatPoints(entry.sessions)} ${entry.sessions === 1 ? 'session' : 'sessions'}`,
    ];
    return `\`${placementLabel(entry.rank)}\` **${userText(entry.displayName, NAME_MAX)}** ${GLYPH.dot} ${stats.join(` ${GLYPH.dot} `)}`;
  });
}

/** Metric buttons and a game picker; they re-render this private board in place. */
function controls(board: games.Leaderboard): ReplyPayload['components'] {
  const metricRow = row(
    ...LEADERBOARD_METRICS.map((metric) =>
      button(
        METRIC_LABEL[metric],
        customId(GAMES_NS, GAME_ACTION.board, board.gameKey, metric),
        metric === board.metric ? 'primary' : 'secondary',
        metric === board.metric,
      ),
    ),
  );
  const gamesAvailable = games.listGames();
  if (gamesAvailable.length < 2) return [metricRow];
  const picker = row(
    stringSelect(
      customId(GAMES_NS, GAME_ACTION.boardGame, board.metric),
      'Another game',
      gamesAvailable.map((game) => ({
        label: game.name,
        value: game.key,
        default: game.key === board.gameKey,
      })),
    ),
  );
  return [metricRow, picker];
}

export function leaderboardPanel(board: games.Leaderboard, shared: boolean): ReplyPayload {
  const gameName = games.findGame(board.gameKey)?.name ?? board.gameKey;
  const lines = standingsLines(board);
  return {
    embeds: [
      panel({
        kicker: `LEADERBOARD ${GLYPH.dot} ${METRIC_LABEL[board.metric].toUpperCase()}`,
        title: gameName,
        description:
          lines.join('\n') || 'No ranked results yet. Sessions with two or more players count.',
        footer: LEADERBOARD_FOOTER,
      }),
    ],
    // A shared board is a static card: controls on a public message would re-render it for everyone.
    components: shared ? [] : controls(board),
    ephemeral: !shared,
  };
}

/** Show a leaderboard: a fresh reply, or the private board updated in place. */
export async function showLeaderboard(
  h: HandlerContext,
  gameKey: string | null,
  metric: LeaderboardMetricChoice | null,
  options: { update?: boolean; shared?: boolean } = {},
): Promise<void> {
  if (!gameKey) throw new ValidationError('Choose a game from the list.');
  if (!metric) throw new ValidationError('Choose a leaderboard from the list.');
  const shared = options.shared ?? false;
  const board = await games.getLeaderboard(h.ctx, {
    gameKey,
    metric,
    limit: LEADERBOARD_ROWS,
    // A posted board is read by everyone in the channel, not only the viewer.
    audience: shared ? 'channel' : 'viewer',
  });
  const payload = leaderboardPanel(board, shared);
  if (options.update) await h.interaction.update(payload);
  else await h.respond(payload);
}
