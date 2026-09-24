import { describe, expect, it } from 'vitest';
import { AIConfigurationError, AIDisabledError } from './errors';
import { type AiProviderEnv, createProviderFromEnv } from './factory';
import { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } from './providers/anthropic';
import { DisabledProvider } from './providers/disabled';
import { MockProvider } from './providers/mock';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

const KEY = 'sk-ant-api-key-0123456789abcdefghij';

function env(overrides: Partial<AiProviderEnv>): AiProviderEnv {
  return { AI_PROVIDER: 'disabled', NODE_ENV: 'production', ...overrides };
}

function configError(fn: () => unknown): AIConfigurationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AIConfigurationError);
    return error as AIConfigurationError;
  }
  throw new Error('expected a configuration error');
}

describe('createProviderFromEnv', () => {
  it('builds the disabled provider, which fails every call clearly', async () => {
    const provider = createProviderFromEnv(env({}));
    expect(provider).toBeInstanceOf(DisabledProvider);
    await expect(
      provider.complete({ system: '', messages: [{ role: 'user', content: 'x' }], maxTokens: 1 }),
    ).rejects.toBeInstanceOf(AIDisabledError);
    await expect(provider.health()).resolves.toMatchObject({ ok: false });
  });

  it('builds Anthropic with the default model unless AI_MODEL overrides it', () => {
    const provider = createProviderFromEnv(env({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY }));
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.defaultModel).toBe(ANTHROPIC_DEFAULT_MODEL);
    const custom = createProviderFromEnv(
      env({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_MODEL: 'claude-sonnet-5' }),
    );
    expect(custom.defaultModel).toBe('claude-sonnet-5');
  });

  it('requires a key for Anthropic and OpenAI, and never echoes values', () => {
    const error = configError(() => createProviderFromEnv(env({ AI_PROVIDER: 'anthropic' })));
    expect(error.message).toBe('AI_API_KEY is required when AI_PROVIDER=anthropic');
    configError(() => createProviderFromEnv(env({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt-x' })));
    const badModel = configError(() =>
      createProviderFromEnv(
        env({ AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_MODEL: 'bad model; drop table' }),
      ),
    );
    expect(badModel.message).not.toContain('drop table');
  });

  it('requires a model for OpenAI and a base URL for OpenAI-compatible servers', () => {
    configError(() => createProviderFromEnv(env({ AI_PROVIDER: 'openai', AI_API_KEY: KEY })));
    configError(() =>
      createProviderFromEnv(env({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'llama3' })),
    );
    const local = createProviderFromEnv(
      env({
        AI_PROVIDER: 'openai-compatible',
        AI_MODEL: 'llama3',
        AI_BASE_URL: 'http://127.0.0.1:1234/v1',
      }),
    );
    expect(local).toBeInstanceOf(OpenAICompatibleProvider);
    expect(local.name).toBe('openai-compatible');
    const openai = createProviderFromEnv(
      env({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_MODEL: 'gpt-x' }),
    );
    expect(openai.name).toBe('openai');
  });

  it('BREAK: refuses plain http to remote hosts, non-http schemes and embedded credentials', () => {
    for (const url of [
      'http://models.example.com/v1',
      'http://127.evil.example.com/v1',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@example.com/v1',
      'not a url',
    ]) {
      const error = configError(() =>
        createProviderFromEnv(
          env({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm', AI_BASE_URL: url }),
        ),
      );
      expect(error.message).not.toContain('pass@');
    }
  });

  it('BREAK: refuses the mock provider in production or when NODE_ENV is unset', () => {
    const error = configError(() => createProviderFromEnv(env({ AI_PROVIDER: 'mock' })));
    expect(error.message).toContain('MOCK / DEVELOPMENT ONLY');
    configError(() => createProviderFromEnv({ AI_PROVIDER: 'mock' }));
    expect(
      createProviderFromEnv(env({ AI_PROVIDER: 'mock', NODE_ENV: 'development' })),
    ).toBeInstanceOf(MockProvider);
    expect(createProviderFromEnv(env({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }))).toBeInstanceOf(
      MockProvider,
    );
  });
});
