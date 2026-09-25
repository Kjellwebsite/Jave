import type { BotFeature } from '../types';
import { eventHistoryContextCommand, eventsCommand } from './commands';
import { eventComponents, eventModals } from './components';
import { eventJobHandlers } from './sync-jobs';

/**
 * Discord surface for JAVELIN events and tournaments (core module: calendar).
 * /events, the Event History context menu, RSVP and staff controls, and the
 * discord.events.publish / discord.events.cancel mirror jobs.
 */
export const feature: BotFeature = {
  name: 'events',
  commands: [eventsCommand, eventHistoryContextCommand],
  components: [eventComponents],
  modals: [eventModals],
  jobHandlers: eventJobHandlers,
};
