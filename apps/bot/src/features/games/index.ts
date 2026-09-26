import type { BotFeature } from '../types';
import { challengeCommand } from './commands';
import { gameComponents } from './components';
import { repostDeletedPanel } from './listeners';
import { gameJobHandlers } from './render-job';

/**
 * Discord surface for the games module: /challenge (TRIVIA and REACTION
 * lobbies, leaderboards, stop), the lobby and play buttons, and the
 * discord.games.render job that keeps each session's one public panel in
 * sync. Timers are advanced by core's games.tick job; every transition
 * enqueues a render.
 */
export const feature: BotFeature = {
  name: 'games',
  commands: [challengeCommand],
  components: [gameComponents],
  jobHandlers: gameJobHandlers,
  onMessageDelete: repostDeletedPanel,
};
