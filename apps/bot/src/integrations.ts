import type { BotEnv } from '@jave/config';
import { createProviderFromEnv, isAIError } from '@jave/ai';
import { type ai, research } from '@jave/core';

/** The bot's external integrations, built once from the environment. */
export interface BotIntegrations {
  /**
   * AI provider + daily ceiling. Absent when the AI configuration is invalid:
   * AI is then unavailable (features report DISABLED, the `ai` health check
   * reads down) while the rest of the bot keeps running.
   */
  ai: ai.AiDeps | undefined;
  researchJobs: research.ResearchJobDeps;
  /**
   * Configuration problems to log at startup. Each names the variable to fix,
   * never its value.
   */
  problems: IntegrationProblem[];
}

export interface IntegrationProblem {
  integration: 'ai' | 'sidus';
  reason: string;
}

const UNKNOWN_REASON = 'invalid configuration';

function aiFromEnv(env: BotEnv, problems: IntegrationProblem[]): ai.AiDeps | undefined {
  try {
    return {
      provider: createProviderFromEnv(env),
      dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT,
    };
  } catch (error) {
    if (!isAIError(error)) throw error;
    problems.push({ integration: 'ai', reason: error.message });
    return undefined;
  }
}

function sidusFromEnv(env: BotEnv, problems: IntegrationProblem[]): research.SidusClient {
  try {
    return research.createSidusClient({ baseUrl: env.SIDUS_API_URL, apiKey: env.SIDUS_API_KEY });
  } catch (error) {
    // The client names the variable (SIDUS_API_URL / SIDUS_API_KEY), never its value.
    problems.push({
      integration: 'sidus',
      reason: error instanceof Error ? error.message : UNKNOWN_REASON,
    });
    return new research.NotConfiguredSidusClient();
  }
}

/**
 * AI provider (AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL — disabled by
 * default; `mock` is MOCK / DEVELOPMENT ONLY and refused in production) and
 * the SIDUS SCIENCE client (SIDUS_API_URL + SIDUS_API_KEY; without both, the
 * honest not-configured client records every sync as not synced). An invalid
 * integration degrades to unavailable and is reported in `problems`; it
 * never takes the bot down and never fakes a result.
 */
export function integrationsFromEnv(env: BotEnv): BotIntegrations {
  const problems: IntegrationProblem[] = [];
  const aiDeps = aiFromEnv(env, problems);
  const sidus = sidusFromEnv(env, problems);
  return {
    ai: aiDeps,
    researchJobs: { ...research.defaultResearchJobDeps(), sidus },
    problems,
  };
}
