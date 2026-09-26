import type { BotEnv } from '@jave/config';
import { createProviderFromEnv } from '@jave/ai';
import { type ai, research } from '@jave/core';

/** The bot's external integrations, built once from the environment. */
export interface BotIntegrations {
  ai: ai.AiDeps;
  researchJobs: research.ResearchJobDeps;
}

/**
 * AI provider (AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL — disabled by
 * default; `mock` is MOCK / DEVELOPMENT ONLY and refused in production) and
 * the SIDUS SCIENCE client (SIDUS_API_URL + SIDUS_API_KEY; without both, the
 * honest not-configured client records every sync as not synced). Throws on
 * invalid configuration with a message that names the variable, never its
 * value.
 */
export function integrationsFromEnv(env: BotEnv): BotIntegrations {
  return {
    ai: { provider: createProviderFromEnv(env), dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT },
    researchJobs: {
      ...research.defaultResearchJobDeps(),
      sidus: research.createSidusClient({ baseUrl: env.SIDUS_API_URL, apiKey: env.SIDUS_API_KEY }),
    },
  };
}
