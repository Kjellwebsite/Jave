import { describe, expect, it } from 'vitest';
import {
  AIAbortedError,
  AIAuthError,
  AIInvalidRequestError,
  AIMalformedResponseError,
  AIOverloadedError,
  AIRateLimitError,
  AIRefusalError,
  AITimeoutError,
  AIUnavailableError,
} from '../errors';
import {
  createFakeFetch,
  fakeSleep,
  type FakeRoute,
  hang,
  json,
  networkError,
  text,
} from '../testing/fake-fetch';
import type { AIRequest } from '../types';
import {
  acceptsSamplingParams,
  ANTHROPIC_DEFAULT_MODEL,
  AnthropicProvider,
  opaqueUserId,
  REFUSAL_FALLBACK_BETA,
} from './anthropic';

const API_KEY = 'sk-ant-test-0123456789abcdefghijklmnop';

const request: AIRequest = {
  system: 'You are JAVE.',
  messages: [{ role: 'user', content: 'What is a DOI?' }],
  maxTokens: 512,
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'A persistent identifier.' },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 },
    ...overrides,
  };
}

function provider(routes: FakeRoute[], overrides: Record<string, unknown> = {}) {
  const fake = createFakeFetch(routes);
  const sleeper = fakeSleep();
  const instance = new AnthropicProvider({
    apiKey: API_KEY,
    fetch: fake.fetch,
    timeoutMs: 200,
    retry: { sleep: sleeper.sleep, random: () => 0 },
    ...overrides,
  });
  return { instance, fake, sleeper };
}

describe('AnthropicProvider', () => {
  it('sends a Messages API request and normalizes the response', async () => {
    const { instance, fake } = provider([json(200, message())]);
    const response = await instance.complete(request, {
      context: { userId: 'user-uuid', feature: 'ask', surface: 'discord' },
    });
    expect(response).toMatchObject({
      text: 'A persistent identifier.',
      model: 'claude-opus-5',
      provider: 'anthropic',
      stopReason: 'end_turn',
      usage: { inputTokens: 15, outputTokens: 7 },
    });
    const sent = fake.requests[0]!;
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(sent.headers.get('x-api-key')).toBe(API_KEY);
    expect(sent.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(sent.headers.get('anthropic-beta')).toBe(REFUSAL_FALLBACK_BETA);
    const body = JSON.parse(sent.body);
    expect(body).toMatchObject({
      model: ANTHROPIC_DEFAULT_MODEL,
      max_tokens: 512,
      system: 'You are JAVE.',
      messages: [{ role: 'user', content: 'What is a DOI?' }],
      fallbacks: 'default',
      metadata: { user_id: opaqueUserId('user-uuid') },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(sent.body).not.toContain('user-uuid');
  });

  it('drops sampling parameters for models that reject them and keeps them for older ones', async () => {
    const modern = provider([json(200, message())]);
    await modern.instance.complete({ ...request, temperature: 0.2 });
    expect(JSON.parse(modern.fake.requests[0]!.body)).not.toHaveProperty('temperature');

    const legacy = provider([json(200, message({ model: 'claude-haiku-4-5' }))], {
      defaultModel: 'claude-haiku-4-5',
    });
    await legacy.instance.complete({ ...request, temperature: 0.2 });
    const body = JSON.parse(legacy.fake.requests[0]!.body);
    expect(body.temperature).toBe(0.2);
    expect(body).not.toHaveProperty('fallbacks');
    expect(acceptsSamplingParams('claude-opus-5')).toBe(false);
    expect(acceptsSamplingParams('claude-sonnet-4-6')).toBe(true);
  });

  it('does not send refusal fallbacks to a custom base URL', async () => {
    const { instance, fake } = provider([json(200, message())], {
      baseUrl: 'https://gateway.example.com',
    });
    await instance.complete(request);
    expect(fake.requests[0]!.url).toBe('https://gateway.example.com/v1/messages');
    expect(JSON.parse(fake.requests[0]!.body)).not.toHaveProperty('fallbacks');
  });

  it('retries a 429 honouring retry-after, then succeeds', async () => {
    const { instance, fake, sleeper } = provider([
      json(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } },
        {
          'retry-after': '2',
        },
      ),
      json(200, message()),
    ]);
    const response = await instance.complete(request);
    expect(response.text).toBe('A persistent identifier.');
    expect(fake.requests).toHaveLength(2);
    expect(sleeper.waits).toEqual([2000]);
  });

  it('retries overloaded (529) at most twice, then fails', async () => {
    const { instance, fake, sleeper } = provider([
      json(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
    ]);
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIOverloadedError);
    expect((error as AIOverloadedError).retryable).toBe(true);
    expect(fake.requests).toHaveLength(3);
    expect(sleeper.waits).toEqual([250, 500]);
  });

  it('retries 5xx and network failures as unavailable', async () => {
    const { instance, fake } = provider([
      json(500, { type: 'error', error: { type: 'api_error', message: 'x' } }),
      networkError(),
      json(200, message()),
    ]);
    await expect(instance.complete(request)).resolves.toMatchObject({ provider: 'anthropic' });
    expect(fake.requests).toHaveLength(3);

    const down = provider([networkError()]);
    await expect(down.instance.complete(request)).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('fails fast on auth errors without leaking the key', async () => {
    const { instance, fake } = provider([
      json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid' } }),
    ]);
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIAuthError);
    expect((error as AIAuthError).retryable).toBe(false);
    expect(String((error as Error).message)).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect(fake.requests).toHaveLength(1);
  });

  it('maps a 400 to a non-retryable invalid request without echoing the upstream message', async () => {
    const { instance } = provider([
      json(400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'secret prompt text here' },
      }),
    ]);
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIInvalidRequestError);
    expect((error as Error).message).not.toContain('secret prompt text');
  });

  it('times out a hung request and does not retry it', async () => {
    const { instance, fake } = provider([hang()], { timeoutMs: 30 });
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AITimeoutError);
    expect(fake.requests).toHaveLength(1);
  });

  it('distinguishes a caller abort from a timeout', async () => {
    const { instance } = provider([hang()], { timeoutMs: 5000 });
    const controller = new AbortController();
    const pending = instance.complete(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AIAbortedError);
  });

  it('rejects malformed responses', async () => {
    const notJson = provider([
      text(200, '<html>proxy error</html>', { 'content-type': 'text/html' }),
    ]);
    await expect(notJson.instance.complete(request)).rejects.toBeInstanceOf(
      AIMalformedResponseError,
    );
    const wrongShape = provider([json(200, { hello: 'world' })]);
    await expect(wrongShape.instance.complete(request)).rejects.toBeInstanceOf(
      AIMalformedResponseError,
    );
  });

  it('raises a refusal instead of returning it as an answer', async () => {
    const { instance } = provider([
      json(
        200,
        message({
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: null },
        }),
      ),
    ]);
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIRefusalError);
    expect((error as AIRefusalError).category).toBe('cyber');
    expect((error as AIRefusalError).retryable).toBe(false);
  });

  it('validates requests before any network call', async () => {
    const { instance, fake } = provider([json(200, message())]);
    await expect(instance.complete({ ...request, messages: [] })).rejects.toBeInstanceOf(
      AIInvalidRequestError,
    );
    await expect(
      instance.complete({ ...request, messages: [{ role: 'assistant', content: 'prefill' }] }),
    ).rejects.toBeInstanceOf(AIInvalidRequestError);
    await expect(instance.complete({ ...request, maxTokens: 10_000_000 })).rejects.toBeInstanceOf(
      AIInvalidRequestError,
    );
    expect(fake.requests).toHaveLength(0);
  });

  it('reports health from the models endpoint', async () => {
    const ok = provider([json(200, { id: 'claude-opus-5', type: 'model' })]);
    await expect(ok.instance.health()).resolves.toEqual({
      ok: true,
      detail: 'model claude-opus-5 reachable',
    });
    expect(ok.fake.requests[0]!.url).toContain('/v1/models/claude-opus-5');
    const bad = provider([
      json(401, { type: 'error', error: { type: 'authentication_error', message: 'no' } }),
    ]);
    const health = await bad.instance.health();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain(API_KEY);
  });

  it('rate limit errors carry the retry-after hint', async () => {
    const { instance } = provider(
      [
        json(
          429,
          { type: 'error', error: { type: 'rate_limit_error', message: 'x' } },
          {
            'retry-after': '1',
          },
        ),
      ],
      { retry: { maxRetries: 0 } },
    );
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIRateLimitError);
    expect((error as AIRateLimitError).retryAfterMs).toBe(1000);
  });
});
