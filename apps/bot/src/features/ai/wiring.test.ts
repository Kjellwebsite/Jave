import { describe, expect, it } from 'vitest';
import {
  type AIHealth,
  type AIProvider,
  AnthropicProvider,
  DISABLED_PROVIDER_NAME,
  DisabledProvider,
  MOCK_PROVIDER_NAME,
  MockProvider,
} from '@jave/ai';
import { parseEnv, fullBotEnvSchema } from '@jave/config';
import { ManualClock, research } from '@jave/core';
import { AI_HEALTH_CACHE_MS, AI_MISCONFIGURED_DETAIL, aiHealthCheck } from '../../health/checks';
import { integrationsFromEnv } from '../../integrations';

/** Just enough bot environment to parse (fake ids and token, TEST ONLY). */
const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://jave:jave@localhost:5432/jave_test',
  DISCORD_CLIENT_ID: '200000000000000001',
  DISCORD_GUILD_ID: '300000000000000001',
  DISCORD_TOKEN: 't'.repeat(60),
};
const SECRET = 'sk-test-secret-value-never-logged';

/** A provider whose health answer the test controls; counts probes. */
class ProbeCountingProvider extends MockProvider {
  probes = 0;
  constructor(private readonly answer: () => Promise<AIHealth>) {
    super();
  }
  override async health(): Promise<AIHealth> {
    this.probes += 1;
    return this.answer();
  }
}

describe('ai wiring: integrations from the environment', () => {
  it('defaults to the disabled provider and the not-configured Sidus client', () => {
    const integrations = integrationsFromEnv(parseEnv(fullBotEnvSchema, BASE_ENV));
    expect(integrations.ai?.provider.name).toBe(DISABLED_PROVIDER_NAME);
    expect(integrations.ai?.dailyRequestCeiling).toBe(50);
    expect(integrations.researchJobs.sidus.configured).toBe(false);
    expect(integrations.researchJobs.sidus).toBeInstanceOf(research.NotConfiguredSidusClient);
    expect(integrations.problems).toEqual([]);
  });

  it('builds the MOCK / DEVELOPMENT ONLY provider outside production, and real clients from env', () => {
    const mock = integrationsFromEnv(
      parseEnv(fullBotEnvSchema, { ...BASE_ENV, AI_PROVIDER: 'mock', AI_DAILY_REQUEST_LIMIT: '7' }),
    );
    expect(mock.ai?.provider.name).toBe(MOCK_PROVIDER_NAME);
    expect(mock.ai?.dailyRequestCeiling).toBe(7);
    const real = integrationsFromEnv(
      parseEnv(fullBotEnvSchema, {
        ...BASE_ENV,
        AI_PROVIDER: 'anthropic',
        AI_API_KEY: SECRET,
        SIDUS_API_URL: 'https://sidus.example.org',
        SIDUS_API_KEY: SECRET,
      }),
    );
    expect(real.ai?.provider).toBeInstanceOf(AnthropicProvider);
    expect(real.researchJobs.sidus).toBeInstanceOf(research.HttpSidusClient);
    expect(real.problems).toEqual([]);
  });

  it('BREAK: an invalid integration degrades to unavailable, names the variable, never echoes a secret', () => {
    const cases: [Record<string, string>, 'ai' | 'sidus', RegExp][] = [
      [{ AI_PROVIDER: 'anthropic' }, 'ai', /AI_API_KEY/],
      [
        { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: `http://example.org/?k=${SECRET}` },
        'ai',
        /AI_/,
      ],
      [
        { SIDUS_API_URL: `http://sidus.example.org/?k=${SECRET}`, SIDUS_API_KEY: SECRET },
        'sidus',
        /SIDUS_API_URL/,
      ],
    ];
    for (const [extra, integration, variable] of cases) {
      const result = integrationsFromEnv(parseEnv(fullBotEnvSchema, { ...BASE_ENV, ...extra }));
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]!.integration).toBe(integration);
      expect(result.problems[0]!.reason).toMatch(variable);
      expect(JSON.stringify(result.problems)).not.toContain(SECRET);
      if (integration === 'ai') expect(result.ai).toBeUndefined();
      else expect(result.researchJobs.sidus).toBeInstanceOf(research.NotConfiguredSidusClient);
    }
    expect(() =>
      parseEnv(fullBotEnvSchema, { ...BASE_ENV, NODE_ENV: 'production', AI_PROVIDER: 'mock' }),
    ).toThrow(/AI_PROVIDER/);
  });
});

describe('ai wiring: health check', () => {
  it('reports disabled without probing the disabled provider', async () => {
    const check = aiHealthCheck(new DisabledProvider(), new ManualClock());
    expect(check.critical).toBe(false);
    await expect(check.run()).resolves.toMatchObject({ status: 'disabled' });
  });

  it('reports an invalid AI configuration (no provider) as down, never as disabled', async () => {
    await expect(aiHealthCheck(undefined, new ManualClock()).run()).resolves.toEqual({
      status: 'down',
      detail: AI_MISCONFIGURED_DETAIL,
    });
  });

  it('reports ok and down from provider.health(), and a throwing probe as down', async () => {
    const ok = aiHealthCheck(new MockProvider(), new ManualClock());
    await expect(ok.run()).resolves.toMatchObject({ status: 'ok' });
    const failing = new ProbeCountingProvider(async () => ({ ok: false, detail: 'auth rejected' }));
    await expect(aiHealthCheck(failing, new ManualClock()).run()).resolves.toEqual({
      status: 'down',
      detail: 'auth rejected',
    });
    const throwing: AIProvider = new ProbeCountingProvider(() =>
      Promise.reject(new Error(`boom ${SECRET}`)),
    );
    const result = await aiHealthCheck(throwing, new ManualClock()).run();
    expect(result.status).toBe('down');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('caches a probe for a minute and shares one in-flight probe', async () => {
    const clock = new ManualClock();
    const provider = new ProbeCountingProvider(async () => ({ ok: true, detail: 'fine' }));
    const check = aiHealthCheck(provider, clock);
    await Promise.all([check.run(), check.run(), check.run()]);
    expect(provider.probes).toBe(1);
    clock.advance(AI_HEALTH_CACHE_MS - 1);
    await check.run();
    expect(provider.probes).toBe(1);
    clock.advance(1);
    await check.run();
    expect(provider.probes).toBe(2);
  });
});
