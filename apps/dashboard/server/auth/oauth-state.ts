import 'server-only';
import { z } from 'zod';
import { MINUTE, randomToken } from '@jave/core';
import { safeNextPath } from '@/lib/routes';
import { createPkceVerifier } from './pkce';
import { signValue, verifySignedValue } from './signed-value';

/** The OAuth round trip must complete within this window. */
export const OAUTH_STATE_TTL_MS = 10 * MINUTE;
const STATE_BYTES = 32;
const SIGNING_PURPOSE = 'jave.oauth-state.v1';
/** A signed cookie larger than this is rejected before any parsing. */
const MAX_SIGNED_STATE_LENGTH = 2048;

const oauthStateSchema = z.object({
  state: z.string().min(32).max(128),
  verifier: z.string().min(43).max(128),
  next: z.string().max(512),
  expiresAt: z.number().int().positive(),
});

export type OAuthState = z.infer<typeof oauthStateSchema>;

export function createOAuthState(nextPath: string | null, now: Date): OAuthState {
  return {
    state: randomToken(STATE_BYTES),
    verifier: createPkceVerifier(),
    next: safeNextPath(nextPath),
    expiresAt: now.getTime() + OAUTH_STATE_TTL_MS,
  };
}

export function encodeOAuthState(value: OAuthState, secret: string): string {
  return signValue(JSON.stringify(value), secret, SIGNING_PURPOSE);
}

/** Null when the cookie is missing, tampered with, malformed or expired. */
export function decodeOAuthState(
  signed: string | undefined,
  secret: string,
  now: Date,
): OAuthState | null {
  if (!signed || signed.length > MAX_SIGNED_STATE_LENGTH) return null;
  const payload = verifySignedValue(signed, secret, SIGNING_PURPOSE);
  if (payload === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = oauthStateSchema.safeParse(json);
  if (!parsed.success || parsed.data.expiresAt <= now.getTime()) return null;
  return { ...parsed.data, next: safeNextPath(parsed.data.next) };
}
