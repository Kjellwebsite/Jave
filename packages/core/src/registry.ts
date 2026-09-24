import { createEventHandlers, type EventSubscriber } from './events/bus';
import type { JobHandlerMap, RecurringJob } from './jobs/worker';
import * as achievements from './achievements';
import * as adversarial from './adversarial';
import * as ai from './ai';
import * as analytics from './analytics';
import * as applications from './applications';
import * as calendar from './calendar';
import * as games from './games';
import * as integrations from './integrations';
import * as invites from './invites';
import * as missions from './missions';
import * as moderation from './moderation';
import * as projects from './projects';
import * as research from './research';
import * as tickets from './tickets';
import * as trials from './trials';
import * as verification from './verification';

/**
 * Composition root for the domain layer's background work. The bot's worker
 * merges these with its own Discord side-effect handlers.
 */
const MODULES = [
  achievements,
  adversarial,
  ai,
  analytics,
  applications,
  calendar,
  games,
  integrations,
  invites,
  missions,
  moderation,
  projects,
  research,
  tickets,
  trials,
  verification,
] as const;

export const coreSubscribers: readonly EventSubscriber[] = MODULES.flatMap((m) => m.subscribers);

export const coreRecurringJobs: readonly RecurringJob[] = MODULES.flatMap((m) => m.recurringJobs);

export function coreJobHandlers(): JobHandlerMap {
  const handlers: Record<string, JobHandlerMap[string]> = {};
  for (const module of MODULES) {
    for (const [type, handler] of Object.entries(module.jobHandlers)) {
      if (handlers[type]) throw new Error(`duplicate job handler for ${type}`);
      handlers[type] = handler;
    }
  }
  for (const [type, handler] of Object.entries(createEventHandlers(coreSubscribers))) {
    handlers[type] = handler;
  }
  return handlers;
}
