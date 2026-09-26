import { SlashCommandBuilder } from 'discord.js';
import { games, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { failure, panel, success } from '../../ui/components';
import { userText } from '../../ui/format';
import { GLYPH } from '../../ui/theme';
import { LEADERBOARD_METRICS, METRIC_LABEL } from './constants';
import { promptStop } from './components';
import { gameKeyOf, metricOf, showLeaderboard } from './leaderboard';

const { trivia, reaction } = games;
const DIFFICULTIES = ['mixed', ...trivia.TRIVIA_DIFFICULTIES] as const;

const categoryLabel = (category: string) => category.replace(/_/g, ' ');

/** The channel a game runs in: a guild channel, never a DM. */
function gameChannel(h: HandlerContext): string {
  const channelId = h.interaction.channelId;
  if (!h.interaction.guildId || !channelId) {
    throw new ValidationError('Games run in JAVELIN channels, not in direct messages.');
  }
  return channelId;
}

/**
 * Open a lobby in the invoking channel. The panel is posted by the render
 * job, which runs before the reply so the host learns right away when the
 * channel was refused (the host or JAVE cannot post there).
 */
async function openLobby(
  h: HandlerContext,
  gameKey: string,
  config: Record<string, unknown>,
): Promise<void> {
  const channelId = gameChannel(h);
  await h.interaction.defer({ ephemeral: true });
  const created = await games.createSession(h.ctx, {
    gameKey,
    surface: 'discord',
    discordChannelId: channelId,
    config,
  });
  await h.services.runJobsNow(h.ctx.effects.jobIds);
  const session = await games.getSessionView(h.ctx, { sessionId: created.id });
  if (session.status === 'abandoned') {
    await h.respond({
      embeds: [
        failure(
          'CHANNEL UNAVAILABLE',
          `${userText(session.endReason ?? 'JAVE cannot post in this channel.')} Open the lobby in a channel where both of you can post.`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }
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

/** /challenge stop: the live game in this channel, behind a confirmation. */
async function stopHere(h: HandlerContext): Promise<void> {
  const live = await games.findLiveSession(h.ctx, { discordChannelId: gameChannel(h) });
  if (!live) {
    await h.respond({
      embeds: [
        panel({ title: 'No game here', description: 'Nothing is running in this channel.' }),
      ],
      ephemeral: true,
    });
    return;
  }
  await promptStop(h, live.id);
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
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Host or event staff: stop the game in this channel.'),
    )
    .toJSON(),
  help: {
    category: 'community',
    summary: 'Trivia and reaction games in this channel, and their leaderboards.',
    usage: '/challenge trivia | reaction | leaderboard | stop',
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
      case 'leaderboard':
        return showLeaderboard(h, gameKeyOf(o.string('game')), metricOf(o.string('metric')), {
          shared: o.boolean('share') ?? false,
        });
      case 'stop':
        return stopHere(h);
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};
