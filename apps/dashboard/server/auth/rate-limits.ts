import 'server-only';
import { consumeRateLimit, RateLimitedError, type ServiceContext } from '@jave/core';

/** Sign-in attempts per client per window. Generous for humans, tight for scripts. */
export const AUTH_RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 60 },
  callback: { limit: 20, windowSeconds: 60 },
  devLogin: { limit: 30, windowSeconds: 60 },
} as const;

export type AuthRateLimit = keyof typeof AUTH_RATE_LIMITS;

const MAX_CLIENT_KEY_LENGTH = 64;

/**
 * True when the attempt is allowed; false when the client is over the limit.
 * Counts in core's shared fixed-window buckets, so the limit holds across
 * dashboard instances.
 */
export async function allowAuthAttempt(
  ctx: ServiceContext,
  kind: AuthRateLimit,
  clientKey: string,
): Promise<boolean> {
  const { limit, windowSeconds } = AUTH_RATE_LIMITS[kind];
  const key = `auth:${kind}:${clientKey.slice(0, MAX_CLIENT_KEY_LENGTH)}`;
  try {
    await consumeRateLimit(ctx, key, limit, windowSeconds);
    return true;
  } catch (error) {
    if (error instanceof RateLimitedError) return false;
    throw error;
  }
}
