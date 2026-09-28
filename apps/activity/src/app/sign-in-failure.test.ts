import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { AuthMismatchError } from '../platform/hosts';
import {
  autoRetryDelay,
  describeSignInFailure,
  MAX_AUTO_RETRY_MS,
  MIN_AUTO_RETRY_MS,
} from './sign-in-failure';

describe('sign-in failures', () => {
  it('BREAK: a throttled sign-in says JAVELIN is busy and retries after Retry-After', () => {
    const problem = describeSignInFailure(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests.', null, 12),
      'discord',
    );
    expect(problem).toMatchObject({ title: 'JAVELIN IS BUSY', retryAfterMs: 12_000 });
    expect(problem.title).not.toContain('CONNECTION');
  });

  it('clamps the automatic wait whatever the server asks for', () => {
    expect(autoRetryDelay(0)).toBe(MIN_AUTO_RETRY_MS);
    expect(autoRetryDelay(3_600)).toBe(MAX_AUTO_RETRY_MS);
    expect(autoRetryDelay(null)).toBeGreaterThanOrEqual(MIN_AUTO_RETRY_MS);
    expect(autoRetryDelay(null)).toBeLessThanOrEqual(MAX_AUTO_RETRY_MS);
  });

  it('keeps lost connections, refusals and mismatches for the member to act on', () => {
    const offline = describeSignInFailure(
      new ApiError(0, 'OFFLINE', 'Connection lost.'),
      'discord',
    );
    expect(offline).toMatchObject({ title: 'CONNECTION LOST', retryAfterMs: null });
    const down = describeSignInFailure(new ApiError(503, 'DISABLED', 'Off.'), 'discord');
    expect(down).toMatchObject({ title: 'CONNECTION LOST', retryAfterMs: null });
    const refused = describeSignInFailure(new ApiError(403, 'FORBIDDEN', 'Banned.'), 'discord');
    expect(refused).toMatchObject({ title: 'ACCESS RESTRICTED', description: 'Banned.' });
    expect(describeSignInFailure(new AuthMismatchError(), 'discord').title).toBe('SIGN-IN REFUSED');
    const dev = describeSignInFailure(new ApiError(404, 'NOT_FOUND', 'Not found.'), 'dev');
    expect(dev.title).toBe('DEV SIGN-IN DISABLED');
    expect(describeSignInFailure(new Error('boom'), 'discord')).toMatchObject({
      title: 'SIGN-IN FAILED',
      retryAfterMs: null,
    });
  });
});
