import type { ComponentHandler, ModalHandler } from '../../interactions/types';
import type { BotFeature } from '../types';
import { sidusCommand } from './commands';
import { ACTION, RESEARCH_NS } from './constants';
import { openReview, requestSync, requireItemId, showItem, submitReview, unknownControl } from './items';
import { saveToSidusContext } from './save';

/** Buttons and the item select. Ids route; core authorizes the clicking member. */
const components: ComponentHandler = {
  namespace: RESEARCH_NS,
  async handle(h, action, args) {
    switch (action) {
      case ACTION.open:
        return showItem(h, requireItemId(h.interaction.values[0]));
      case ACTION.view:
        return showItem(h, requireItemId(args[0]));
      case ACTION.review:
        return openReview(h, requireItemId(args[0]));
      case ACTION.sync:
        return requestSync(h, requireItemId(args[0]));
      default:
        return unknownControl(h);
    }
  },
};

const modals: ModalHandler = {
  namespace: RESEARCH_NS,
  async handle(h, action, args) {
    if (action === ACTION.review) return submitReview(h, requireItemId(args[0]), args[1]);
    return unknownControl(h);
  },
};

/**
 * Discord surface for the research domain (SIDUS SCIENCE library). The
 * module defines no `discord.*` jobs: enrichment and the Sidus push are core
 * jobs, wired with this deployment's Sidus client in app.ts.
 */
export const feature: BotFeature = {
  name: 'research',
  commands: [sidusCommand, saveToSidusContext],
  components: [components],
  modals: [modals],
};
