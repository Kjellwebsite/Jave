import { integrations } from '@jave/core';
import { actionDispatcher } from '../projects/actions';
import type { BotFeature } from '../types';
import {
  githubCommand,
  githubComponentActions,
  githubModalActions,
  INTEGRATIONS_NS,
} from './github';
import { relayHandler } from './relay';

/**
 * Discord surface for the integrations domain: linked GitHub accounts
 * (/github) and the `discord.integrations.relay` job that posts sanitized
 * generic-webhook summaries to a configured channel.
 */
export const feature: BotFeature = {
  name: 'integrations',
  commands: [githubCommand],
  components: [actionDispatcher(INTEGRATIONS_NS, githubComponentActions)],
  modals: [actionDispatcher(INTEGRATIONS_NS, githubModalActions)],
  jobHandlers: (services) => ({
    [integrations.DISCORD_INTEGRATIONS_RELAY_JOB]: relayHandler(services),
  }),
};
