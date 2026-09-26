import 'server-only';
import { z } from 'zod';
import { HOUR, MINUTE } from '@jave/core';
import { signValue, verifySignedValue } from '@/server/auth/signed-value';
import type { ActivityAuthMode } from './contract';
import { activityInstanceIdSchema } from './instance';

/**
 * The Activity bearer token ("jave_token"): an HMAC-SHA256-signed claim set
 * `{ sub: userId, iid: activityInstanceId, iat, exp, mode }`, signed with
 * JAVE_SESSION_SECRET under its own purpose label (domain separation: an
 * OAuth state cookie or any other signed value never verifies as a token).
 *
 * It asserts identity only. Every request re-resolves the user's roles and
 * standing through core, so a ban or role change applies immediately.
 */
const TOKEN_PURPOSE = 'jave.activity-token.v1';
const TOKEN_VERSION = 1;
/** Issued lifetime. The client re-authenticates silently before it runs out. */
export const ACTIVITY_TOKEN_TTL_MS = HOUR;
/** Hard ceiling: a token claiming a longer lifetime is rejected even if correctly signed. */
export const ACTIVITY_TOKEN_MAX_TTL_MS = 2 * HOUR;
/** Tolerated forward skew for `iat` (several dashboard instances, imperfect clocks). */
const MAX_ISSUED_AT_SKEW_MS = MINUTE;
/** Anything longer than this is not one of our tokens; rejected before any crypto. */
export const MAX_ACTIVITY_TOKEN_LENGTH = 1024;

const claimsSchema = z
  .object({
    v: z.literal(TOKEN_VERSION),
    sub: z.uuid(),
    iid: activityInstanceIdSchema,
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
    mode: z.enum(['discord', 'dev']),
  })
  .strict();

export type ActivityTokenClaims = z.infer<typeof claimsSchema>;

export interface IssuedActivityToken {
  token: string;
  expiresAt: number;
}

export function issueActivityToken(
  input: { userId: string; instanceId: string; mode: ActivityAuthMode },
  secret: string,
  now: Date,
): IssuedActivityToken {
  const iat = now.getTime();
  const claims: ActivityTokenClaims = {
    v: TOKEN_VERSION,
    sub: input.userId,
    iid: input.instanceId,
    iat,
    exp: iat + ACTIVITY_TOKEN_TTL_MS,
    mode: input.mode,
  };
  return { token: signValue(JSON.stringify(claims), secret, TOKEN_PURPOSE), expiresAt: claims.exp };
}

/**
 * Null when the token is missing, oversized, tampered with, signed with
 * another secret or purpose, malformed, expired, issued in the future, or
 * claims a lifetime above the ceiling.
 */
export function verifyActivityToken(
  token: string,
  secret: string,
  now: Date,
): ActivityTokenClaims | null {
  if (token.length === 0 || token.length > MAX_ACTIVITY_TOKEN_LENGTH) return null;
  const payload = verifySignedValue(token, secret, TOKEN_PURPOSE);
  if (payload === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(json);
  if (!parsed.success) return null;
  const claims = parsed.data;
  const nowMs = now.getTime();
  if (claims.exp <= nowMs) return null;
  if (claims.iat > nowMs + MAX_ISSUED_AT_SKEW_MS) return null;
  if (claims.exp <= claims.iat || claims.exp - claims.iat > ACTIVITY_TOKEN_MAX_TTL_MS) return null;
  return claims;
}
