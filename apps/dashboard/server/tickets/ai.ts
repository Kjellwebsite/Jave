import 'server-only';
import { DISABLED_PROVIDER_NAME } from '@jave/ai';
import type { ai } from '@jave/core';
import { getIntegrations } from '../ai';

/**
 * The AI provider behind the ticket summary panel: the dashboard's single
 * per-process AI integration (server/ai.ts, built from AI_PROVIDER, AI_MODEL,
 * AI_API_KEY, AI_BASE_URL, AI_DAILY_REQUEST_LIMIT). `null` means summaries
 * are DISABLED on this deployment: no provider, or a misconfigured one
 * (logged by variable name, never its value). The console keeps working
 * either way.
 */
export interface TicketAi {
  deps: ai.AiDeps | null;
}

/** Summaries are available only with a provider other than the disabled one. */
export function ticketAiFrom(deps: ai.AiDeps): TicketAi {
  return { deps: deps.provider.name === DISABLED_PROVIDER_NAME ? null : deps };
}

export function getTicketAi(): TicketAi {
  return ticketAiFrom(getIntegrations().ai);
}
