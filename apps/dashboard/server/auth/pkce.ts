import 'server-only';
import { createHash } from 'node:crypto';
import { randomToken } from '@jave/core';

/** 32 random bytes → 43 base64url characters (RFC 7636 allows 43–128 unreserved characters). */
const VERIFIER_BYTES = 32;

export function createPkceVerifier(): string {
  return randomToken(VERIFIER_BYTES);
}

/** S256 code challenge: BASE64URL(SHA256(ASCII(code_verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
