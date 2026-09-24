import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEPARATOR = '.';

function mac(purpose: string, body: string, secret: string): string {
  // The purpose label gives domain separation: a value signed for one use
  // never verifies for another, even under the same secret.
  return createHmac('sha256', secret).update(`${purpose}\n${body}`).digest('base64url');
}

/** `<base64url(payload)>.<base64url(HMAC-SHA256)>` */
export function signValue(payload: string, secret: string, purpose: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  return `${body}${SEPARATOR}${mac(purpose, body, secret)}`;
}

/** Returns the payload when the signature is valid, otherwise null. Constant-time comparison. */
export function verifySignedValue(signed: string, secret: string, purpose: string): string | null {
  const index = signed.indexOf(SEPARATOR);
  if (index <= 0 || index !== signed.lastIndexOf(SEPARATOR)) return null;
  const body = signed.slice(0, index);
  const given = Buffer.from(signed.slice(index + 1));
  const expected = Buffer.from(mac(purpose, body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Buffer.from(body, 'base64url').toString('utf8');
}
