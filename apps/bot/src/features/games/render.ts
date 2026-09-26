import { games } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, panel, row } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import {
  GAME_ACTION,
  GAMES_NS,
  LEADERBOARD_ROWS,
  type LeaderboardMetricChoice,
  LOBBY_ROWS,
  METRIC_LABEL,
  OPTION_LETTERS,
  SCOREBOARD_ROWS,
  TAP,
} from './constants';

type Render = games.GameRender;
type TriviaView = games.trivia.TriviaPublicView;
type ReactionView = games.reaction.ReactionPublicView;

const NAME_MAX = 48;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const RANK_WIDTH = 2;

function isTriviaView(view: unknown): view is TriviaView {
  return (
    typeof view === 'object' && view !== null && 'game' in view && view.game === games.trivia.TRIVIA_KEY
  );
}

function isReactionView(view: unknown): view is ReactionView {
  return (
    typeof view === 'object' &&
    view !== null &&
    'game' in view &&
    view.game === games.reaction.REACTION_KEY
  );
}

const at = (epochMs: number) => new Date(epochMs);
const points = (value: number) => NUMBER_FORMAT.format(value);
const rank = (value: number) => String(value).padStart(RANK_WIDTH, '0');

/** A player as a non-pinging mention (embeds never ping), or their name. */
function playerName(render: Render, userId: string): string {
  const discordId = render.playerDiscordIds[userId];
  if (discordId) return `<@${discordId}>`;
  const player = render.session.players.find((candidate) => candidate.userId === userId);
  return userText(player?.displayName ?? 'Unknown player', NAME_MAX);
}

function kicker(render: Render, ...parts: string[]): string {
  return [render.session.gameName.toUpperCase(), ...parts].join(` ${GLYPH.dot} `);
}

function configLine(session: games.SessionView): string {
  const config = session.config;
  const parts: string[] = [];
  if (typeof config.rounds === 'number') parts.push(`${config.rounds} rounds`);
  if (typeof config.secondsPerQuestion === 'number') {
    parts.push(`${config.secondsPerQuestion} s per question`);
  }
  if (typeof config.difficulty === 'string') parts.push(`${config.difficulty} difficulty`);
  if (Array.isArray(config.categories) && config.categories.length > 0) {
    parts.push(config.categories.map((category) => String(category).replace(/_/g, ' ')).join(', '));
  }
  return parts.join(` ${GLYPH.dot} `);
}

const moveId = (render: Render, round: number, choice: string | number) =>
  customId(GAMES_NS, GAME_ACTION.move, render.session.id, round, choice);

function lobbyPanel(render: Render): MessagePayload {
  const { session } = render;
  const count = session.players.length;
  const names = session.players
    .slice(0, LOBBY_ROWS)
    .map((player) => {
      const host = player.userId === session.hostUserId ? ` ${GLYPH.dot} host` : '';
      return `${GLYPH.bullet} ${playerName(render, player.userId)}${host}`;
    });
  if (count > LOBBY_ROWS) names.push(`${GLYPH.dot} and ${count - LOBBY_ROWS} more`);
  const id = session.id;
  return {
    embeds: [
      panel({
        kicker: kicker(render, 'LOBBY'),
        title: `${session.gameName} ${GLYPH.dot} lobby`,
        description: [configLine(session), 'JOIN to play. The host starts the game.']
          .filter(Boolean)
          .join('\n'),
        fields: [field(`Players ${count} / ${session.maxPlayers}`, names.join('\n') || 'Nobody yet.')],
      }),
    ],
    components: [
      row(
        button('Join', customId(GAMES_NS, GAME_ACTION.join, id), 'primary', count >= session.maxPlayers),
        button('Leave', customId(GAMES_NS, GAME_ACTION.leave, id)),
        button('Start', customId(GAMES_NS, GAME_ACTION.start, id), 'success', count < session.minPlayers),
        button('Cancel', customId(GAMES_NS, GAME_ACTION.abandon, id), 'danger'),
      ),
    ],
  };
}

function scoreboardLines(
  render: Render,
  entries: readonly { playerId: string; score: number; placement: number }[],
  mark?: (playerId: string) => string,
): string {
  const lines = entries
    .slice(0, SCOREBOARD_ROWS)
    .map(
      (entry) =>
        `\`${rank(entry.placement)}\` ${playerName(render, entry.playerId)} ${GLYPH.dot} ${points(entry.score)}${mark ? ` ${mark(entry.playerId)}` : ''}`,
    );
  if (entries.length > SCOREBOARD_ROWS) {
    lines.push(`${GLYPH.dot} and ${entries.length - SCOREBOARD_ROWS} more`);
  }
  return lines.join('\n');
}

function optionLines(view: TriviaView): string[] {
  return (view.question?.options ?? []).map((option, index) => {
    const letter = `\`${OPTION_LETTERS[index] ?? String(index + 1)}\``;
    const text = userText(option, 200);
    if (view.correctIndex === null) return `${letter} ${text}`;
    return index === view.correctIndex
      ? `${GLYPH.verified} ${letter} **${text}**`
      : `${GLYPH.dot} ${letter} ${text}`;
  });
}

function triviaPanel(render: Render, view: TriviaView): MessagePayload {
  const question = view.question;
  const heading = question
    ? kicker(
        render,
        question.category.replace(/_/g, ' ').toUpperCase(),
        question.difficulty.toUpperCase(),
      )
    : kicker(render);
  const prompt = question ? `**${userText(question.prompt, 500)}**` : '';
  if (view.phase === 'question' && question && view.closesAt !== null) {
    return {
      embeds: [
        panel({
          kicker: heading,
          title: `Round ${view.round} / ${view.totalRounds}`,
          description: [
            prompt,
            optionLines(view).join('\n'),
            `Closes ${discordTime(at(view.closesAt), 'R')} ${GLYPH.dot} ${view.answeredCount} / ${view.playerCount} answered`,
          ].join('\n\n'),
          color: COLORS.chrome,
        }),
      ],
      components: [
        row(
          ...question.options.map((_, index) =>
            button(OPTION_LETTERS[index] ?? String(index + 1), moveId(render, view.round, index), 'secondary'),
          ),
        ),
      ],
    };
  }
  const last = view.round >= view.totalRounds;
  const next =
    view.revealUntil === null
      ? ''
      : last
        ? `Final standings ${discordTime(at(view.revealUntil), 'R')}`
        : `Next question ${discordTime(at(view.revealUntil), 'R')}`;
  const markFor = (playerId: string) => {
    const entry = view.scoreboard.find((candidate) => candidate.playerId === playerId);
    if (!entry?.answered) return GLYPH.unknown;
    return entry.correct ? GLYPH.verified : GLYPH.cross;
  };
  return {
    embeds: [
      panel({
        kicker: heading,
        title: `Round ${view.round} / ${view.totalRounds} ${GLYPH.dot} answer`,
        description: [
          prompt,
          optionLines(view).join('\n'),
          view.fact ? `_${userText(view.fact, 300)}_` : '',
          next,
        ]
          .filter(Boolean)
          .join('\n\n'),
        fields: [field('Scoreboard', scoreboardLines(render, view.scoreboard, markFor))],
      }),
    ],
    components: [],
  };
}

function reactionResultLine(
  render: Render,
  result: NonNullable<ReactionView['results']>[number],
): string {
  const who = playerName(render, result.playerId);
  if (result.falseStart) return `${who} ${GLYPH.dot} FALSE START`;
  if (result.reactionMs === null) return `${who} ${GLYPH.dot} no tap`;
  return `${who} ${GLYPH.dot} ${points(result.reactionMs)} ms ${GLYPH.dot} +${points(result.points)}`;
}

function reactionPanel(render: Render, view: ReactionView): MessagePayload {
  const heading = kicker(render, `ROUND ${view.round} / ${view.totalRounds}`);
  const tapped = `${view.tappedCount} / ${view.playerCount} tapped`;
  if (view.phase === 'wait') {
    return {
      embeds: [
        panel({
          kicker: heading,
          title: 'Wait for GO',
          description: `Tap only after GO. An early tap loses the round.\n\n${tapped}`,
          color: COLORS.steel,
        }),
      ],
      components: [row(button('Tap', moveId(render, view.round, TAP)))],
    };
  }
  if (view.phase === 'go' && view.closesAt !== null) {
    return {
      embeds: [
        panel({
          kicker: heading,
          title: 'GO',
          description: `Tap now. Window closes ${discordTime(at(view.closesAt), 'R')}.\n\n${tapped}`,
          color: COLORS.success,
        }),
      ],
      components: [row(button('Tap', moveId(render, view.round, TAP), 'primary'))],
    };
  }
  const results = (view.results ?? []).map((result) => reactionResultLine(render, result));
  return {
    embeds: [
      panel({
        kicker: heading,
        title: `Round ${view.round} / ${view.totalRounds} ${GLYPH.dot} results`,
        description: results.join('\n') || 'No taps this round.',
        fields: [field('Scoreboard', scoreboardLines(render, view.scoreboard))],
      }),
    ],
    components: [],
  };
}

function standingsPanel(render: Render): MessagePayload {
  const { session } = render;
  const standings = session.players
    .filter((player) => player.placement !== null)
    .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
    .map((player) => ({
      playerId: player.userId,
      score: player.score ?? 0,
      placement: player.placement ?? 0,
    }));
  const ranked = session.players.length >= games.MIN_RANKED_PLAYERS;
  const winners = standings.filter((entry) => games.isWin(entry, ranked));
  const verdict = !ranked
    ? 'PRACTICE — solo sessions are not ranked.'
    : winners.length === 0
      ? 'NO WINNER — nobody scored.'
      : winners.length === 1
        ? `WINNER — ${playerName(render, winners[0]!.playerId)} ${GLYPH.dot} ${points(winners[0]!.score)}`
        : `SHARED WIN — ${winners.map((entry) => playerName(render, entry.playerId)).join(', ')}`;
  return {
    embeds: [
      panel({
        kicker: kicker(render, 'FINAL'),
        title: 'Final standings',
        description: verdict,
        color: COLORS.chrome,
        fields: [field('Standings', scoreboardLines(render, standings) || GLYPH.unknown)],
        timestamp: session.endedAt ?? undefined,
      }),
    ],
    components: [],
  };
}

function endedPanel(render: Render): MessagePayload {
  return {
    embeds: [
      panel({
        kicker: kicker(render, 'ENDED'),
        title: 'Game ended',
        description: userText(render.session.endReason ?? 'The game was stopped.', 300),
        color: COLORS.steel,
      }),
    ],
    components: [],
  };
}

/** The session's one public panel, from the spectator view (never per-player data). */
export function gamePanel(render: Render): MessagePayload {
  const { session } = render;
  if (session.status === 'lobby') return lobbyPanel(render);
  if (session.status === 'completed') return standingsPanel(render);
  if (session.status === 'abandoned') return endedPanel(render);
  if (isTriviaView(session.view)) return triviaPanel(render, session.view);
  if (isReactionView(session.view)) return reactionPanel(render, session.view);
  return {
    embeds: [
      panel({
        kicker: kicker(render, 'LIVE'),
        title: session.gameName,
        description: 'This game runs on the JAVELIN Activity. Open it from the voice channel.',
      }),
    ],
    components: [],
  };
}

export function leaderboardPanel(
  board: games.Leaderboard,
  gameName: string,
  ephemeral: boolean,
): ReplyPayload {
  const metric = board.metric as LeaderboardMetricChoice;
  const lines = board.entries.slice(0, LEADERBOARD_ROWS).map((entry) => {
    const stats = [
      `${points(entry.wins)} ${entry.wins === 1 ? 'win' : 'wins'}`,
      `best ${points(entry.bestScore)}`,
      `${points(entry.sessions)} ${entry.sessions === 1 ? 'session' : 'sessions'}`,
    ];
    return `\`${rank(entry.rank)}\` **${userText(entry.displayName, NAME_MAX)}** ${GLYPH.dot} ${stats.join(` ${GLYPH.dot} `)}`;
  });
  return {
    embeds: [
      panel({
        kicker: `LEADERBOARD ${GLYPH.dot} ${METRIC_LABEL[metric].toUpperCase()}`,
        title: gameName,
        description:
          lines.join('\n') ||
          'No ranked results yet. Sessions with two or more players count.',
        footer: 'Ranked sessions only. Members who hide themselves from leaderboards are not listed.',
      }),
    ],
    ephemeral,
  };
}
