import { describe, expect, it } from 'vitest';
import {
  AIAuthError,
  AIInvalidRequestError,
  AIMalformedResponseError,
  AIRateLimitError,
  AIRefusalError,
  AITimeoutError,
} from '../errors';
import {
  createFakeFetch,
  fakeSleep,
  type FakeRoute,
  hang,
  json,
  text,
} from '../testing/fake-fetch';
import type { AIRequest } from '../types';
import { MAX_COMPLETION_RESPONSE_BYTES, OpenAICompatibleProvider } from './openai-compatible';

const API_KEY = 'sk-proj-test-abcdefghijklmnopqrstuvwxyz0123';

const request: AIRequest = {
  system: 'You are JAVE.',
  messages: [{ role: 'user', content: 'Summarize.' }],
  maxTokens: 256,
  stop: ['END'],
};

function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1',
    model: 'llama3.1:8b',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 3 },
    ...overrides,
  };
}

function provider(routes: FakeRoute[], overrides: Record<string, unknown> = {}) {
  const fake = createFakeFetch(routes);
  const sleeper = fakeSleep();
  const instance = new OpenAICompatibleProvider({
    baseUrl: 'http://localhost:11434/v1/',
    defaultModel: 'llama3.1:8b',
    fetch: fake.fetch,
    timeoutMs: 200,
    retry: { sleep: sleeper.sleep, random: () => 0 },
    ...overrides,
  });
  return { instance, fake, sleeper };
}

describe('OpenAICompatibleProvider', () => {
  it('posts a chat completion and normalizes the response', async () => {
    const { instance, fake } = provider([json(200, completion())], { apiKey: API_KEY });
    const response = await instance.complete(request);
    expect(response).toMatchObject({
      text: 'Done.',
      model: 'llama3.1:8b',
      provider: 'openai-compatible',
      stopReason: 'end_turn',
      usage: { inputTokens: 20, outputTokens: 3 },
    });
    const sent = fake.requests[0]!;
    expect(sent.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(sent.body)).toEqual({
      model: 'llama3.1:8b',
      messages: [
        { role: 'system', content: 'You are JAVE.' },
        { role: 'user', content: 'Summarize.' },
      ],
      max_tokens: 256,
      stop: ['END'],
    });
  });

  it('omits the authorization header without a key and supports max_completion_tokens', async () => {
    const { instance, fake } = provider([json(200, completion())], {
      maxTokensField: 'max_completion_tokens',
    });
    await instance.complete(request);
    expect(fake.requests[0]!.headers.has('authorization')).toBe(false);
    expect(JSON.parse(fake.requests[0]!.body).max_completion_tokens).toBe(256);
  });

  it('retries 429 with retry-after then succeeds', async () => {
    const { instance, fake, sleeper } = provider([
      json(429, { error: { type: 'rate_limit_exceeded' } }, { 'retry-after': '3' }),
      json(200, completion()),
    ]);
    await expect(instance.complete(request)).resolves.toMatchObject({ text: 'Done.' });
    expect(fake.requests).toHaveLength(2);
    expect(sleeper.waits).toEqual([3000]);
  });

  it('gives up after two retries on persistent 503', async () => {
    const { instance, fake } = provider([json(503, { error: { type: 'server_error' } })]);
    await expect(instance.complete(request)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fake.requests).toHaveLength(3);
  });

  it('does not retry auth errors or 400s', async () => {
    const auth = provider([json(401, { error: { type: 'invalid_api_key' } })]);
    await expect(auth.instance.complete(request)).rejects.toBeInstanceOf(AIAuthError);
    expect(auth.fake.requests).toHaveLength(1);
    const bad = provider([json(400, { error: { type: 'invalid_request_error' } })]);
    await expect(bad.instance.complete(request)).rejects.toBeInstanceOf(AIInvalidRequestError);
    expect(bad.fake.requests).toHaveLength(1);
  });

  it('times out hung requests', async () => {
    const { instance } = provider([hang()], { timeoutMs: 30 });
    await expect(instance.complete(request)).rejects.toBeInstanceOf(AITimeoutError);
  });

  it('rejects malformed and oversized responses', async () => {
    const notJson = provider([text(200, 'not json')]);
    await expect(notJson.instance.complete(request)).rejects.toBeInstanceOf(
      AIMalformedResponseError,
    );
    const noChoices = provider([json(200, { choices: [] })]);
    await expect(noChoices.instance.complete(request)).rejects.toBeInstanceOf(
      AIMalformedResponseError,
    );
    const huge = provider([text(200, 'x'.repeat(MAX_COMPLETION_RESPONSE_BYTES + 1))]);
    await expect(huge.instance.complete(request)).rejects.toBeInstanceOf(AIMalformedResponseError);
  });

  it('raises refusals from the refusal field and the content filter', async () => {
    const refusal = provider([
      json(
        200,
        completion({
          choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }],
        }),
      ),
    ]);
    await expect(refusal.instance.complete(request)).rejects.toBeInstanceOf(AIRefusalError);
    const filtered = provider([
      json(
        200,
        completion({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }),
      ),
    ]);
    await expect(filtered.instance.complete(request)).rejects.toBeInstanceOf(AIRefusalError);
  });

  it('maps length to max_tokens', async () => {
    const { instance } = provider([
      json(
        200,
        completion({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
      ),
    ]);
    await expect(instance.complete(request)).resolves.toMatchObject({ stopReason: 'max_tokens' });
  });

  it('reports health without leaking the key', async () => {
    const ok = provider([json(200, { data: [] })], { apiKey: API_KEY });
    await expect(ok.instance.health()).resolves.toMatchObject({ ok: true });
    expect(ok.fake.requests[0]!.url).toBe('http://localhost:11434/v1/models');
    const denied = provider([json(401, {})], { apiKey: API_KEY });
    const health = await denied.instance.health();
    expect(health.ok).toBe(false);
    expect(health.detail).not.toContain(API_KEY);
  });

  it('carries retry-after on rate limit errors when retries are exhausted', async () => {
    const { instance } = provider([json(429, {}, { 'retry-after': '1' })], {
      retry: { maxRetries: 0 },
    });
    const error = await instance.complete(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIRateLimitError);
    expect((error as AIRateLimitError).retryAfterMs).toBe(1000);
  });
});
