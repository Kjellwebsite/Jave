import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { createIntegrationJobHandlers } from './handlers';
import { outboundWebhookSubscriber } from './outbound.subscriber';

// Module: integrations — registry, inbound webhooks, external accounts, outbound webhooks.
export * from './constants';
export * from './config';
export * from './secrets';
export * from './signatures';
export * from './ssrf';
export * from './payload';
export * from './registry.service';
export * from './inbound.service';
export * from './external-accounts.service';
export * from './processors';
export * from './github.processor';
export * from './process.job';
export * from './discord-jobs';
export * from './outbound.service';
export * from './outbound.subscriber';
export * from './outbound.delivery';
export * from './handlers';

/** Job handlers owned by this module (non-Discord), wired with production dependencies. */
export const jobHandlers: JobHandlerMap = createIntegrationJobHandlers();
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [outboundWebhookSubscriber];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [];
