import { SlashCommandBuilder } from 'discord.js';
import { games, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { success } from '../../ui/components';
import { GLYPH } from '../../ui/theme';
import { LEADERBOARD_METRICS, type LeaderboardMetricChoice, METRIC_LABEL } from './constants';
import { leaderboardPanel } from './render';

const { trivia, reaction } = games;
const DIFFICULTIES = ['mixed', ...trivia.TRIVIA_DIFFICULTIES] as const;

const categoryLabel = (category: string) => category.replace(/_/g, ' ');

/** Open a lobby in the invoking channel; the panel itself is posted by the render job. */
async function openLobby(
  h: HandlerContext,
  gameKey: string,
  config: Record<string, unknown>,
): Promise<void> {
  const channelId = h.interaction.channelId;
  if (!h.interaction.guildId || !channelId) {
    throw new ValidationError('Games run in JAVELIN channels, not in direct messages.');
  }
  const session = await games.createSession(h.ctx, {
    gameKey,
    surface: 'discord',
    discordChannelId: channelId,
    config,
  });
  await h.respond({
    embeds: [
      success(
        `Lobby open ${GLYPH.dot} ${session.gameName.toUpperCase()}`,
        'The panel is live in this channel. Players JOIN there; START when everyone is in.',
      ),
    ],
    ephemeral: true,
  });
}

function triviaConfig(h: HandlerContext): Record<string, unknown> {
  const o = h.interaction.options;
  const config: Record<string, unknown> = {};
  const rounds = o.integer('rounds');
  const seconds = o.integer('seconds');
  const difficulty = o.string('difficulty');
  const category = o.string('category');
  if (rounds !== null) config.rounds = rounds;
  if (seconds !== null) config.secondsPerQuestion = seconds;
  if (difficulty !== null) config.difficulty = difficulty;
  if (category !== null) config.categories = [category];
  return config;
}

function metricOf(value: string | null): LeaderboardMetricChoice {
  if (value === null) return 'wins';
  const metric = LEADERBOARD_METRICS.find((candidate) => candidate === value);
  if (!metric) throw new ValidationError('Choose a leaderboard from the list.');
  return metric;
}

export const challengeCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Games in this channel: trivia, reaction, leaderboards.')
    .addSubcommand((sub) =>
      sub
        .setName('trivia')
        .setDescription('Open a trivia lobby in this channel.')
        .addIntegerOption((option) =>
          option
            .setName('rounds')
            .setDescription(`Questions (default ${trivia.TRIVIA_DEFAULT_ROUNDS})`)
            .setMinValue(trivia.TRIVIA_MIN_ROUNDS)
            .setMaxValue(trivia.TRIVIA_MAX_ROUNDS),
        )
        .addIntegerOption((option) =>
          option
            .setName('seconds')
            .setDescription(`Seconds per question (default ${trivia.TRIVIA_DEFAULT_SECONDS})`)
            .setMinValue(trivia.TRIVIA_MIN_SECONDS)
            .setMaxValue(trivia.TRIVIA_MAX_SECONDS),
        )
        .addStringOption((option) =>
          option
            .setName('difficulty')
            .setDescription('Question difficulty (default mixed)')
            .addChoices(...DIFFICULTIES.map((value) => ({ name: value, value }))),
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('One category only (default: all)')
            .addChoices(
              ...trivia.TRIVIA_CATEGORIES.map((value) => ({ name: categoryLabel(value), value })),
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reaction')
        .setDescription('Open a reaction lobby: wait for GO, then tap.')
        .addIntegerOption((option) =>
          option
            .setName('rounds')
            .setDescription(`Rounds (default ${reaction.REACTION_DEFAULT_ROUNDS})`)
            .setMinValue(reaction.REACTION_MIN_ROUNDS)
            .setMaxValue(reaction.REACTION_MAX_ROUNDS),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('leaderboard')
        .setDescription('Game leaderboards (ranked sessions only).')
        .addStringOption((option) =>
          option
            .setName('game')
            .setDescription('Game (default trivia)')
            .addChoices(...games.listGames().map((game) => ({ name: game.name, value: game.key }))),
        )
        .addStringOption((option) =>
          option
            .setName('metric')
            .setDescription('Order by (default wins)')
            .addChoices(
              ...LEADERBOARD_METRICS.map((value) => ({ name: METRIC_LABEL[value], value })),
            ),
        )
        .addBooleanOption((option) =>
          option.setName('share').setDescription('Post visibly in this channel'),
        ),
    )
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Trivia and reaction games in this channel, and their leaderboards.',
    usage: '/challenge trivia | reaction | leaderboard',
  },

  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'trivia':
        return openLobby(h, trivia.TRIVIA_KEY, triviaConfig(h));
      case 'reaction': {
        const rounds = o.integer('rounds');
        return openLobby(h, reaction.REACTION_KEY, rounds === null ? {} : { rounds });
      }
      case 'leaderboard': {
        const gameKey = o.string('game') ?? trivia.TRIVIA_KEY;
        const board = await games.getLeaderboard(h.ctx, { gameKey, metric: metricOf(o.string('metric')) });
        const name = games.findGame(board.gameKey)?.name ?? board.gameKey;
        return h.respond(leaderboardPanel(board, name, !(o.boolean('share') ?? false)));
      }
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};
