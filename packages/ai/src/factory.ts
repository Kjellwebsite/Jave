import type { AiEnv } from '@jave/config';
import { AIConfigurationError } from './errors';
import { type FetchLike, validateBaseUrl } from './http';
import type { RetryPolicy } from './retry';
import { AnthropicProvider } from './providers/anthropic';
import { DisabledProvider } from './providers/disabled';
import { MockProvider } from './providers/mock';
import { OPENAI_DEFAULT_BASE_URL, OpenAICompatibleProvider } from './providers/openai-compatible';
import { type AIProvider, MODEL_ID_PATTERN } from './types';

/**
 * `@jave/config`'s AiEnv plus the development-only `mock` provider and the
 * runtime mode. `AI_PROVIDER=mock` requires NODE_ENV=development or test.
 */
export type AiProviderKind = AiEnv['AI_PROVIDER'] | 'mock';

export interface AiProviderEnv extends Omit<AiEnv, 'AI_PROVIDER' | 'AI_DAILY_REQUEST_LIMIT'> {
  AI_PROVIDER: AiProviderKind;
  AI_DAILY_REQUEST_LIMIT?: number;
  NODE_ENV?: 'development' | 'test' | 'production';
}

export interface ProviderFactoryDeps {
  fetch?: FetchLike;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
}

const MOCK_ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set(['development', 'test']);

function requireValue(value: string | undefined, variable: string, provider: string): string {
  if (!value?.trim()) {
    throw new AIConfigurationError(`${variable} is required when AI_PROVIDER=${provider}`);
  }
  return value.trim();
}

function validModel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!MODEL_ID_PATTERN.test(value)) {
    throw new AIConfigurationError('AI_MODEL must be a model id of at most 64 characters');
  }
  return value;
}

/**
 * Build the configured provider. Throws AIConfigurationError (naming the
 * variable, never its value) on invalid configuration.
 */
export function createProviderFromEnv(
  env: AiProviderEnv,
  deps: ProviderFactoryDeps = {},
): AIProvider {
  const model = validModel(env.AI_MODEL);
  const common = { fetch: deps.fetch, timeoutMs: deps.timeoutMs, retry: deps.retry };
  switch (env.AI_PROVIDER) {
    case 'disabled':
      return new DisabledProvider();
    case 'mock':
      if (!env.NODE_ENV || !MOCK_ALLOWED_ENVIRONMENTS.has(env.NODE_ENV)) {
        throw new AIConfigurationError(
          'AI_PROVIDER=mock is MOCK / DEVELOPMENT ONLY and requires NODE_ENV=development or test',
        );
      }
      return new MockProvider({ model });
    case 'anthropic': {
      const baseUrl = env.AI_BASE_URL
        ? validateBaseUrl(env.AI_BASE_URL, 'AI_BASE_URL').toString()
        : undefined;
      return new AnthropicProvider({
        ...common,
        apiKey: requireValue(env.AI_API_KEY, 'AI_API_KEY', 'anthropic'),
        defaultModel: model,
        baseUrl,
      });
    }
    case 'openai':
      return new OpenAICompatibleProvider({
        ...common,
        name: 'openai',
        baseUrl: validateBaseUrl(
          env.AI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL,
          'AI_BASE_URL',
        ).toString(),
        apiKey: requireValue(env.AI_API_KEY, 'AI_API_KEY', 'openai'),
        defaultModel: requireValue(model, 'AI_MODEL', 'openai'),
        maxTokensField: 'max_completion_tokens',
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        ...common,
        name: 'openai-compatible',
        baseUrl: validateBaseUrl(
          requireValue(env.AI_BASE_URL, 'AI_BASE_URL', 'openai-compatible'),
          'AI_BASE_URL',
        ).toString(),
        apiKey: env.AI_API_KEY?.trim() || undefined,
        defaultModel: requireValue(model, 'AI_MODEL', 'openai-compatible'),
      });
    default: {
      const unknown: never = env.AI_PROVIDER;
      throw new AIConfigurationError(`AI_PROVIDER ${String(unknown)} is not supported`);
    }
  }
}
