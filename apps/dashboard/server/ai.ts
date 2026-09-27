import 'server-only';
import {
  type AIProvider,
  createProviderFromEnv,
  DISABLED_PROVIDER_NAME,
  DisabledProvider,
  MOCK_PROVIDER_NAME,
} from '@jave/ai';
import { ai, research, type ServiceContext, type tickets } from '@jave/core';
import { getRuntime } from './runtime';

/**
 * The dashboard's AI and Sidus integration, built once per process from the
 * environment. Unlike the bot (which refuses to start), a misconfigured
 * provider degrades to disabled here and the /ai page names the variable to
 * fix — the rest of the console keeps working. Errors name variables, never
 * their values.
 */
export interface DashboardIntegrations {
  ai: ai.AiDeps;
  aiConfigurationError: string | null;
  /** MOCK / DEVELOPMENT ONLY provider in use (never in production: the env schema refuses it). */
  aiIsMock: boolean;
  sidusConfigured: boolean;
  sidusConfigurationError: string | null;
}

export type ProviderState = 'ok' | 'down' | 'disabled';

export interface ProviderStatus {
  state: ProviderState;
  provider: string;
  model: string;
  detail: string;
  checkedAt: Date;
}

/** Provider health is a network call: reuse it for a minute across requests. */
export const PROVIDER_STATUS_CACHE_MS = 60_000;
/** Page renders never wait longer than this for the provider's health probe. */
export const PROVIDER_STATUS_TIMEOUT_MS = 4000;
const TIMED_OUT_DETAIL = 'Health check timed out.';
const FAILED_DETAIL = 'Health check failed.';

const INTEGRATIONS_KEY = Symbol.for('jave.dashboard.integrations');
const STATUS_KEY = Symbol.for('jave.dashboard.ai-status');

type Host = typeof globalThis & {
  [INTEGRATIONS_KEY]?: DashboardIntegrations;
  [STATUS_KEY]?: { at: number; status: Promise<ProviderStatus> };
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'invalid configuration';
}

function createIntegrations(): DashboardIntegrations {
  const { env, logger } = getRuntime();
  let provider: AIProvider;
  let aiConfigurationError: string | null = null;
  try {
    provider = createProviderFromEnv(env);
  } catch (error) {
    aiConfigurationError = messageOf(error);
    logger.error({ reason: aiConfigurationError }, 'AI provider misconfigured; AI disabled');
    provider = new DisabledProvider();
  }
  let sidusConfigured = false;
  let sidusConfigurationError: string | null = null;
  try {
    sidusConfigured = research.createSidusClient({
      baseUrl: env.SIDUS_API_URL,
      apiKey: env.SIDUS_API_KEY,
    }).configured;
  } catch (error) {
    sidusConfigurationError = messageOf(error);
  }
  return {
    ai: { provider, dailyRequestCeiling: env.AI_DAILY_REQUEST_LIMIT },
    aiConfigurationError,
    aiIsMock: provider.name === MOCK_PROVIDER_NAME,
    sidusConfigured,
    sidusConfigurationError,
  };
}

export function getIntegrations(): DashboardIntegrations {
  const host = globalThis as Host;
  host[INTEGRATIONS_KEY] ??= createIntegrations();
  return host[INTEGRATIONS_KEY];
}

/** The AI dependencies every `ai.*` call from the dashboard takes. */
export function getAiDeps(): ai.AiDeps {
  return getIntegrations().ai;
}

/**
 * The tickets AI summary extension point for a dashboard request: core's
 * guarded AI path with this process's provider, as the signed-in member.
 * Usage: `tickets.summarizeTicket(ctx, ticketId, ticketSummarizerFor(ctx))`.
 * With AI disabled it refuses with the AI module's own DisabledError.
 */
export function ticketSummarizerFor(ctx: ServiceContext): tickets.TicketSummarizer {
  return ai.ticketSummarizer(ctx, getAiDeps(), 'dashboard');
}

/**
 * One bounded reachability probe: `disabled` for the disabled provider
 * (never probed), otherwise `ok`/`down` from `provider.health()`. A hanging
 * or throwing probe reads as down with a generic detail (provider errors can
 * carry upstream text; it is never shown).
 */
export async function probeProvider(
  provider: AIProvider,
  now: () => Date,
  timeoutMs: number = PROVIDER_STATUS_TIMEOUT_MS,
): Promise<ProviderStatus> {
  const base = { provider: provider.name, model: provider.defaultModel };
  if (provider.name === DISABLED_PROVIDER_NAME) {
    return { ...base, state: 'disabled', detail: 'AI_PROVIDER=disabled', checkedAt: now() };
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const health = await Promise.race([provider.health(), timeout]);
    if (health === 'timeout') {
      return { ...base, state: 'down', detail: TIMED_OUT_DETAIL, checkedAt: now() };
    }
    return { ...base, state: health.ok ? 'ok' : 'down', detail: health.detail, checkedAt: now() };
  } catch {
    return { ...base, state: 'down', detail: FAILED_DETAIL, checkedAt: now() };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Provider reachability for the /ai page, cached for PROVIDER_STATUS_CACHE_MS. */
export function getProviderStatus(now: () => Date = () => new Date()): Promise<ProviderStatus> {
  const host = globalThis as Host;
  const cached = host[STATUS_KEY];
  const at = now().getTime();
  if (cached && at - cached.at < PROVIDER_STATUS_CACHE_MS) return cached.status;
  const status = probeProvider(getIntegrations().ai.provider, now);
  host[STATUS_KEY] = { at, status };
  return status;
}
