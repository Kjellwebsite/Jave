import { describe, expect, it } from 'vitest';
import {
  AIAuthError,
  AIOverloadedError,
  AIRateLimitError,
  AITimeoutError,
  errorForStatus,
} from './errors';
import { parseRetryAfterMs, retryDelayMs, retryPolicy, withRetry } from './retry';
import { fakeSleep } from './testing/fake-fetch';

describe('retry policy', () => {
  it('retries transient failures at most twice', async () => {
    const sleeper = fakeSleep();
    let calls = 0;
    const error = await withRetry(
      async () => {
        calls++;
        throw new AIOverloadedError({ provider: 'p' });
      },
      retryPolicy({ sleep: sleeper.sleep, random: () => 1 }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIOverloadedError);
    expect(calls).toBe(3);
    expect(sleeper.waits).toEqual([500, 1000]);
  });

  it('does not retry auth errors or timeouts', async () => {
    for (const failure of [
      new AIAuthError({ provider: 'p' }),
      new AITimeoutError({ provider: 'p', timeoutMs: 1 }),
    ]) {
      let calls = 0;
      await withRetry(
        async () => {
          calls++;
          throw failure;
        },
        retryPolicy({ sleep: fakeSleep().sleep }),
      ).catch(() => undefined);
      expect(calls).toBe(1);
    }
  });

  it('caps server-provided retry-after', () => {
    const policy = retryPolicy();
    const error = new AIRateLimitError({ provider: 'p', retryAfterMs: 3_600_000 });
    expect(retryDelayMs(error, 0, policy)).toBe(policy.maxDelayMs);
  });

  it('parses retry-after in seconds, milliseconds and HTTP dates', () => {
    expect(parseRetryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
    expect(parseRetryAfterMs(new Headers({ 'retry-after-ms': '150' }))).toBe(150);
    const now = Date.parse('2026-03-01T12:00:00Z');
    expect(
      parseRetryAfterMs(new Headers({ 'retry-after': 'Sun, 01 Mar 2026 12:00:05 GMT' }), now),
    ).toBe(5000);
    expect(parseRetryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
    expect(parseRetryAfterMs(new Headers())).toBeUndefined();
  });

  it('classifies HTTP statuses', () => {
    expect(errorForStatus(401, { provider: 'p' }).kind).toBe('auth');
    expect(errorForStatus(403, { provider: 'p' }).kind).toBe('auth');
    expect(errorForStatus(429, { provider: 'p' }).kind).toBe('rate_limited');
    expect(errorForStatus(529, { provider: 'p' }).kind).toBe('overloaded');
    expect(errorForStatus(500, { provider: 'p', upstreamType: 'overloaded_error' }).kind).toBe(
      'overloaded',
    );
    expect(errorForStatus(502, { provider: 'p' }).kind).toBe('unavailable');
    expect(errorForStatus(404, { provider: 'p' }).kind).toBe('invalid_request');
    expect(errorForStatus(413, { provider: 'p' }).retryable).toBe(false);
  });
});
