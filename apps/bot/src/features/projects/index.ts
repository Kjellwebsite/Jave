import type { BotFeature } from '../types';
import { actionDispatcher, mergeActions } from './actions';
import { PROJECTS_NS } from './constants';
import {
  contributeCommand,
  contributionComponentActions,
  contributionModalActions,
} from './contribute';
import { recordContributionCommand } from './context-menu';
import { projectComponentActions, projectModalActions } from './project-actions';
import { projectCommand } from './project-command';

/**
 * Discord surface for projects and contributions: /project, /contribute,
 * the "Record Contribution" message context menu and the review queue.
 * Custom ids route only; every handler calls core as the clicking user.
 */
export const feature: BotFeature = {
  name: 'projects',
  commands: [projectCommand, contributeCommand, recordContributionCommand],
  components: [
    actionDispatcher(
      PROJECTS_NS,
      mergeActions(PROJECTS_NS, projectComponentActions, contributionComponentActions),
    ),
  ],
  modals: [
    actionDispatcher(
      PROJECTS_NS,
      mergeActions(PROJECTS_NS, projectModalActions, contributionModalActions),
    ),
  ],
};
