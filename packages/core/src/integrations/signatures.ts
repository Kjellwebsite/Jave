import { hmacSha256Hex, safeEqual } from '../kernel/crypto';

/**
 * Webhook signature schemes. Pure functions: no I/O, no clock reads.
 *
 * GitHub:  X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, rawBody)>
 * JAVE v1: X-Jave-Timestamp: <unix seconds>
 *          X-Jave-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<rawBody>")>
 *
 * All comparisons are constant-time.
 */

export const GITHUB_SIGNATURE_PREFIX = 'sha256=';
export const JAVE_SIGNATURE_VERSION = 'v1';

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const UNIX_SECONDS = /^\d{1,12}$/;
const MILLIS_PER_SECOND = 1000;

export function signGithub(secret: string, rawBody: string): string {
  return `${GITHUB_SIGNATURE_PREFIX}${hmacSha256Hex(secret, rawBody)}`;
}

export function verifyGithubSignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
): boolean {
  if (!header?.startsWith(GITHUB_SIGNATURE_PREFIX)) return false;
  const provided = header.slice(GITHUB_SIGNATURE_PREFIX.length).toLowerCase();
  if (!HEX_SHA256.test(provided)) return false;
  return safeEqual(provided, hmacSha256Hex(secret, rawBody));
}

/** The string both sides sign: binds the timestamp to the body. */
export function javeSigningPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

export function signJave(secret: string, timestamp: string, body: string): string {
  return `${JAVE_SIGNATURE_VERSION}=${hmacSha256Hex(secret, javeSigningPayload(timestamp, body))}`;
}

export type JaveSignatureFailure =
  | 'missing_headers'
  | 'malformed_timestamp'
  | 'timestamp_out_of_range'
  | 'malformed_signature'
  | 'signature_mismatch';

export type JaveSignatureResult = { ok: true } | { ok: false; reason: JaveSignatureFailure };

/**
 * Verify a JAVE v1 signature. The header may carry several comma-separated
 * `v1=` entries (e.g. during a sender's secret rotation); any match passes.
 */
export function verifyJaveSignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  now: Date;
  windowMs: number;
}): JaveSignatureResult {
  if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing_headers' };
  if (!UNIX_SECONDS.test(input.timestamp)) return { ok: false, reason: 'malformed_timestamp' };
  const sentAt = Number(input.timestamp) * MILLIS_PER_SECOND;
  if (Math.abs(input.now.getTime() - sentAt) > input.windowMs) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }
  const candidates = input.signature
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${JAVE_SIGNATURE_VERSION}=`))
    .map((entry) => entry.slice(JAVE_SIGNATURE_VERSION.length + 1).toLowerCase())
    .filter((hex) => HEX_SHA256.test(hex));
  if (candidates.length === 0) return { ok: false, reason: 'malformed_signature' };
  const expected = hmacSha256Hex(input.secret, javeSigningPayload(input.timestamp, input.body));
  // Compare every candidate so timing does not reveal which one matched.
  const matched = candidates.map((hex) => safeEqual(hex, expected)).some(Boolean);
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}
