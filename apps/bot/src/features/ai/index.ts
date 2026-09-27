import { ai } from '@jave/core';
import type { ComponentHandler, ModalHandler } from '../../interactions/types';
import type { BotFeature } from '../types';
import { AI_NS, turnPage } from './answers';
import { announceHandler } from './announce-job';
import { SLASH_MODALS, type SlashModal, slashCommands, submitSlashModal } from './commands';
import { contextMenus, submitMessageQuestion } from './context-menus';
import { cancelFromButton, confirmFromButton, expiredControl } from './proposals';

function isSlashModal(action: string): action is SlashModal {
  return (SLASH_MODALS as readonly string[]).includes(action);
}

/** Buttons: answer paging and proposal decisions. Ids route; core authorizes. */
const components: ComponentHandler = {
  namespace: AI_NS,
  async handle(h, action, args) {
    const [first, second] = args;
    if (action === 'page' && first && second !== undefined) {
      return turnPage(h, first, Number(second));
    }
    if (action === 'confirm' && first) return confirmFromButton(h, first);
    if (action === 'cancel' && first) return cancelFromButton(h, first);
    return expiredControl(h);
  },
};

const modals: ModalHandler = {
  namespace: AI_NS,
  async handle(h, action, args) {
    if (isSlashModal(action)) return submitSlashModal(h, action);
    if (action === 'askmsg' && args[0]) return submitMessageQuestion(h, args[0]);
    return expiredControl(h);
  },
};

/** Discord surface for the ai domain: JAVE AI answers, drafts and proposals. */
export const feature: BotFeature = {
  name: 'ai',
  commands: [...slashCommands, ...contextMenus],
  components: [components],
  modals: [modals],
  jobHandlers: (services) => ({ [ai.DISCORD_AI_ANNOUNCE_JOB]: announceHandler(services) }),
};

export { aiUsageReport } from './usage';
