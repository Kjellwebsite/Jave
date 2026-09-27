import { type JobHandlerMap, trials } from '@jave/core';
import type { BotServices } from '../../../runtime';
import { announceHandler } from './announce';
import { archiveHandler, teardownHandler } from './archive';
import { briefHandler, warningHandler } from './channel-posts';
import { provisionHandler } from './provision';

/** One handler per discord.trials.* contract (see packages/core/src/trials/discord-jobs.ts). */
export function trialJobHandlers(services: BotServices): JobHandlerMap {
  return {
    [trials.DISCORD_TRIALS_ANNOUNCE_JOB]: announceHandler(services),
    [trials.DISCORD_TRIALS_PROVISION_JOB]: provisionHandler(services),
    [trials.DISCORD_TRIALS_BRIEF_JOB]: briefHandler(services),
    [trials.DISCORD_TRIALS_WARNING_JOB]: warningHandler(services),
    [trials.DISCORD_TRIALS_ARCHIVE_JOB]: archiveHandler(services),
    [trials.DISCORD_TRIALS_TEARDOWN_JOB]: teardownHandler(services),
  };
}
