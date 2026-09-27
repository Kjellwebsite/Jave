import { DisabledProvider } from '@jave/ai';
import type { ai } from '@jave/core';
import type { BotServices } from '../../runtime';

/**
 * Stand-in for an invalid AI configuration (BotServices.ai absent): core
 * refuses every request with its own DisabledError and records the refusal
 * in the ledger, exactly as with AI_PROVIDER=disabled. Never fabricates.
 */
const UNAVAILABLE_AI: ai.AiDeps = { provider: new DisabledProvider() };

/** The AI dependencies every `ai.*` call from Discord takes. */
export function aiDepsOf(services: Pick<BotServices, 'ai'>): ai.AiDeps {
  return services.ai ?? UNAVAILABLE_AI;
}
