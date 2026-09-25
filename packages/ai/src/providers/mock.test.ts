import { describe, expect, it } from 'vitest';
import { AIRefusalError } from '../errors';
import { MOCK_CALL_HISTORY_LIMIT, MockProvider } from './mock';

const request = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'hello world' }],
  maxTokens: 100,
};

describe('MockProvider (MOCK / DEVELOPMENT ONLY)', () => {
  it('is deterministic and records calls with context', async () => {
    const mock = new MockProvider();
    const a = await mock.complete(request, {
      context: { userId: 'u', feature: 'ask', surface: 'dashboard' },
    });
    const b = await mock.complete(request);
    expect(a.text).toBe(b.text);
    expect(a.text).toContain('MOCK / DEVELOPMENT ONLY');
    expect(a.usage.inputTokens).toBeGreaterThan(0);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]!.context?.feature).toBe('ask');
  });

  it('supports scripted responses and failures', async () => {
    const mock = new MockProvider({
      respond: (req) => {
        if (req.messages[0]!.content === 'refuse') throw new AIRefusalError({ provider: 'mock' });
        return { text: 'scripted', stopReason: 'max_tokens' };
      },
    });
    await expect(mock.complete(request)).resolves.toMatchObject({
      text: 'scripted',
      stopReason: 'max_tokens',
    });
    await expect(
      mock.complete({ ...request, messages: [{ role: 'user', content: 'refuse' }] }),
    ).rejects.toBeInstanceOf(AIRefusalError);
  });

  it('bounds its call history', async () => {
    const mock = new MockProvider();
    for (let i = 0; i < MOCK_CALL_HISTORY_LIMIT + 5; i++) await mock.complete(request);
    expect(mock.calls).toHaveLength(MOCK_CALL_HISTORY_LIMIT);
  });
});
