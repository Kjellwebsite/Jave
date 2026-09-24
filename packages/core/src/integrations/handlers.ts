import type { JobHandlerMap } from '../jobs/worker';
import { DELIVER_OUTBOUND_JOB, PROCESS_DELIVERY_JOB } from './constants';
import { processGithubDelivery } from './github.processor';
import {
  createDeliverOutboundHandler,
  DEFAULT_OUTBOUND_DEPENDENCIES,
  type OutboundDependencies,
} from './outbound.delivery';
import { createProcessDeliveryHandler } from './process.job';
import {
  processGenericDelivery,
  type ProcessorRegistry,
  unconfiguredProcessor,
} from './processors';

/**
 * One explicit entry per provider. Sidus, Supabase and monitoring deliveries
 * are stored and marked ignored ("no processor configured") until a real
 * processor replaces the entry — extension point for the research module.
 */
export const DEFAULT_PROCESSORS: ProcessorRegistry = {
  github: processGithubDelivery,
  generic: processGenericDelivery,
  sidus: unconfiguredProcessor(),
  supabase: unconfiguredProcessor(),
  monitoring: unconfiguredProcessor(),
};

export interface IntegrationDependencies extends OutboundDependencies {
  processors: ProcessorRegistry;
}

/**
 * Build the module's job handlers with explicit dependencies (no hidden
 * globals): tests inject a fake fetch/resolver; the composition root uses
 * the defaults (global fetch, system DNS).
 */
export function createIntegrationJobHandlers(
  overrides: Partial<IntegrationDependencies> = {},
): JobHandlerMap {
  const deps: IntegrationDependencies = {
    ...DEFAULT_OUTBOUND_DEPENDENCIES,
    processors: DEFAULT_PROCESSORS,
    ...overrides,
  };
  return {
    [PROCESS_DELIVERY_JOB]: createProcessDeliveryHandler(deps.processors),
    [DELIVER_OUTBOUND_JOB]: createDeliverOutboundHandler(deps),
  };
}
