import 'server-only';
import { hmacSha256Hex, randomToken, sha256Hex } from '@jave/core';

const SESSION_TOKEN_BYTES = 32;
/** 32 bytes of base64url without padding. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh opaque session token. Only ever sent to the browser in an httpOnly cookie. */
export function newSessionToken(): string {
  return randomToken(SESSION_TOKEN_BYTES);
}

/** What the database stores: the SHA-256 of the token, never the token. */
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export function isWellFormedSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

/**
 * Keyed hash of the client IP for session metadata and rate-limit keys, so
 * raw addresses are never stored.
 */
export function hashClientIp(ip: string, secret: string): string {
  return hmacSha256Hex(secret, `jave.client-ip.v1\n${ip}`);
}
