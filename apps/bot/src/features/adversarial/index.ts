import type { BotFeature } from '../types';
import { adversarialJobHandlers } from './jobs';
import { adversarialComponents } from './operative';
import { stopWordListener } from './stop-word';

/**
 * Discord surface for the adversarial domain: the operative's controls
 * (RED FLAG, trigger fired), the confidential DM / debrief job handlers and
 * the stop-word listener. The operative reads their briefing with
 * `/trial briefing` (the trials command owns the /trial name). Nothing here
 * ever posts to a participant-facing channel before the reveal.
 */
export const feature: BotFeature = {
  name: 'adversarial',
  components: [adversarialComponents],
  jobHandlers: adversarialJobHandlers,
  onMessage: stopWordListener,
};
