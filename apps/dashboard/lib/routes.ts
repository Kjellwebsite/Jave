/** Where signed-out visitors are sent, and where signed-in users land. */
export const LOGIN_PATH = '/login';
export const HOME_PATH = '/overview';

/**
 * Paths reachable without a session. Everything else is gated optimistically
 * in `proxy.ts` (cookie present) and authoritatively in the console layout.
 */
const PUBLIC_EXACT = new Set(['/', LOGIN_PATH, '/api/health', '/icon', '/robots.txt']);
const PUBLIC_PREFIXES = ['/p/', '/api/auth/'];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const MAX_NEXT_PATH_LENGTH = 512;
const LAST_C0_CONTROL = 0x1f;
const DELETE = 0x7f;

function hasControlCharacterOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= LAST_C0_CONTROL || code === DELETE || value[i] === '\\') return true;
  }
  return false;
}

/**
 * Validates a post-login `next` target. Only same-origin, absolute paths are
 * accepted — no scheme, no protocol-relative `//host`, no backslash tricks, no
 * API routes. Anything else falls back to `fallback`.
 */
export function safeNextPath(input: string | null | undefined, fallback = HOME_PATH): string {
  if (!input || input.length > MAX_NEXT_PATH_LENGTH) return fallback;
  if (!input.startsWith('/') || input.startsWith('//') || input.startsWith('/\\')) return fallback;
  // Control characters (incl. tab/newline, which URL parsing silently strips) are never valid.
  if (hasControlCharacterOrBackslash(input)) return fallback;
  const base = 'http://jave.invalid';
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;
  if (parsed.pathname.startsWith('/api/') || parsed.pathname === LOGIN_PATH) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
