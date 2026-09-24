/** Minimal header reader so these checks work with Headers, NextRequest and next/headers. */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * CSRF defence for mutations (Server Actions and any mutating route handler).
 * The request's Origin must be the dashboard's public origin or the host the
 * request was addressed to. Without an Origin header, only a browser-asserted
 * `Sec-Fetch-Site: same-origin` is accepted.
 */
export function isSameOriginRequest(
  headers: HeaderSource,
  trustedOrigins: readonly string[],
): boolean {
  const origin = headers.get('origin');
  if (origin === null) return headers.get('sec-fetch-site') === 'same-origin';
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (trustedOrigins.includes(parsed.origin)) return true;
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headers.get('host');
  return Boolean(host) && parsed.host === host;
}

const MAX_IP_LENGTH = 64;
const UNKNOWN_CLIENT = 'unknown';

/**
 * The client address as seen by the nearest trusted reverse proxy: the
 * right-most X-Forwarded-For entry (the one the proxy appended), which a
 * client cannot forge. Deploy behind exactly one proxy that appends XFF.
 */
export function clientIp(headers: HeaderSource): string {
  const forwarded = headers.get('x-forwarded-for');
  const fromForwarded = forwarded
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  const candidate = fromForwarded || headers.get('x-real-ip')?.trim() || UNKNOWN_CLIENT;
  return candidate.slice(0, MAX_IP_LENGTH);
}
