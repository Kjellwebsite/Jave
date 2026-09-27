import 'server-only';
import { createProviderFromEnv, DISABLED_PROVIDER_NAME, isAIError } from '@jave/ai';
import type { ai } from '@jave/core';
import { getRuntime } from '../runtime';

/**
 * The AI provider behind the ticket summary panel, built once per process
 * from the environment (AI_PROVIDER, AI_MODEL, AI_API_KEY, AI_BASE_URL,
 * AI_DAILY_REQUEST_LIMIT). `null` means summaries are DISABLED on this
 * deployment: no provider, or a misconfigured one (logged by variable name,
 * never its value). The console keeps working either way.
 */
export interface TicketAi {
  deps: ai.AiDeps | null;
}

const TICKET_AI_KEY = Symbol.for('jave.dashboard.ticket-ai');

type Host = typeof globalThis & { [TICKET_AI_KEY]?: TicketAi };

function createTicketAi(): TicketAi {
  const { env, logger } = getRuntime();
  try {
    const provider = createProviderFromEnv(env);
    if (provider.name === DISABLED_PROVIDER_NAME) return { deps: null };
    return { deps: { provider, dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT } };
  } catch (error) {
    if (!isAIError(error)) throw error;
    logger.error({ kind: error.kind, reason: error.message }, 'AI provider misconfigured');
    return { deps: null };
  }
}

export function getTicketAi(): TicketAi {
  const host = globalThis as Host;
  host[TICKET_AI_KEY] ??= createTicketAi();
  return host[TICKET_AI_KEY];
}
