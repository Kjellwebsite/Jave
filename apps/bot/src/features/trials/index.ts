import type { BotFeature } from '../types';
import { teamCommand, trialCommand, trialRecordContextCommand } from './commands';
import { trialComponents, trialModals } from './handlers';
import { trialJobHandlers } from './jobs';

/**
 * Discord surface for the trials domain: /trial (members and the staff
 * control panel), /team, the Trial Record context menu, the recruitment
 * card's APPLY flow, and one job handler per discord.trials.* contract.
 * See docs/commands/trials.md.
 */
export const feature: BotFeature = {
  name: 'trials',
  commands: [trialCommand, teamCommand, trialRecordContextCommand],
  components: [trialComponents],
  modals: [trialModals],
  jobHandlers: trialJobHandlers,
};
