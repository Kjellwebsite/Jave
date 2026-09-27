import { describe, expect, it } from 'vitest';
import {
  type AIHealth,
  AnthropicProvider,
  DISABLED_PROVIDER_NAME,
  DisabledProvider,
  MockProvider,
} from '@jave/ai';
import { integrationsFromEnv, probeProvider } from './ai';
import { ticketAiFrom } from './tickets/ai';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const now = () => NOW;
const SHORT_TIMEOUT_MS = 20;
const SECRET = 'sk-live-never-shown';
const DAILY_LIMIT = 50;

/** Records what would be logged (TEST ONLY). */
function captureLogger() {
  const lines: unknown[] = [];
  return { lines, logger: { error: (...args: unknown[]) => void lines.push(args) } };
}

/** A provider whose health probe the test scripts (TEST ONLY). */
class ScriptedHealthProvider extends MockProvider {
  constructor(private readonly probe: () => Promise<AIHealth>) {
    super();
  }
  override health(): Promise<AIHealth> {
    return this.probe();
  }
}

describe('AI provider status probe', () => {
  it('reports disabled without probing, ok and down from health()', async () => {
    await expect(probeProvider(new DisabledProvider(), now)).resolves.toMatchObject({
      state: 'disabled',
      provider: 'disabled',
    });
    await expect(probeProvider(new MockProvider(), now)).resolves.toMatchObject({
      state: 'ok',
      provider: 'mock',
      checkedAt: NOW,
    });
    const down = new ScriptedHealthProvider(async () => ({ ok: false, detail: 'auth rejected' }));
    await expect(probeProvider(down, now)).resolves.toMatchObject({
      state: 'down',
      detail: 'auth rejected',
    });
  });

  it('BREAK: a hanging probe times out and a throwing one never leaks its message', async () => {
    const hanging = new ScriptedHealthProvider(() => new Promise<AIHealth>(() => undefined));
    await expect(probeProvider(hanging, now, SHORT_TIMEOUT_MS)).resolves.toMatchObject({
      state: 'down',
      detail: 'Health check timed out.',
    });
    const throwing = new ScriptedHealthProvider(() => Promise.reject(new Error(SECRET)));
    const status = await probeProvider(throwing, now);
    expect(status.state).toBe('down');
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });
});

describe('dashboard integrations from the environment', () => {
  it('defaults to disabled AI and no Sidus; ticket summaries read DISABLED', () => {
    const { logger, lines } = captureLogger();
    const integrations = integrationsFromEnv(
      { AI_PROVIDER: 'disabled', AI_DAILY_REQUEST_LIMIT: DAILY_LIMIT },
      logger,
    );
    expect(integrations).toMatchObject({
      aiConfigurationError: null,
      aiIsMock: false,
      sidusConfigured: false,
      sidusConfigurationError: null,
    });
    expect(integrations.ai.provider.name).toBe(DISABLED_PROVIDER_NAME);
    expect(ticketAiFrom(integrations.ai).deps).toBeNull();
    expect(lines).toHaveLength(0);
  });

  it('builds real clients from configuration; ticket summaries use the same provider', () => {
    const { logger } = captureLogger();
    const integrations = integrationsFromEnv(
      {
        AI_PROVIDER: 'anthropic',
        AI_API_KEY: SECRET,
        SIDUS_API_URL: 'https://sidus.example.org',
        SIDUS_API_KEY: SECRET,
      },
      logger,
    );
    expect(integrations.ai.provider).toBeInstanceOf(AnthropicProvider);
    expect(integrations.sidusConfigured).toBe(true);
    expect(ticketAiFrom(integrations.ai).deps).toBe(integrations.ai);
  });

  it('BREAK: misconfiguration degrades to disabled, names the variable, never echoes a secret', () => {
    const { logger, lines } = captureLogger();
    const integrations = integrationsFromEnv(
      {
        AI_PROVIDER: 'openai-compatible',
        AI_BASE_URL: `http://example.org/?k=${SECRET}`,
        SIDUS_API_URL: `http://sidus.example.org/?k=${SECRET}`,
        SIDUS_API_KEY: SECRET,
      },
      logger,
    );
    expect(integrations.ai.provider).toBeInstanceOf(DisabledProvider);
    expect(integrations.aiConfigurationError).toMatch(/AI_/);
    expect(integrations.sidusConfigured).toBe(false);
    expect(integrations.sidusConfigurationError).toMatch(/SIDUS_API_URL/);
    expect(ticketAiFrom(integrations.ai).deps).toBeNull();
    expect(lines).toHaveLength(2);
    expect(JSON.stringify([integrations, lines])).not.toContain(SECRET);
  });
});
