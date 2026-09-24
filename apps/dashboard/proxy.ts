import { type NextRequest, NextResponse } from 'next/server';
import { baseEnvSchema, parseEnv, type BaseEnv } from '@jave/config';
import { SESSION_COOKIE } from './lib/auth/cookie-names';
import { buildContentSecurityPolicy, createNonce } from './lib/csp';
import { isPublicPath, LOGIN_PATH } from './lib/routes';

let runtimeEnv: BaseEnv | undefined;

function isHttps(request: NextRequest): boolean {
  return (
    request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https'
  );
}

/**
 * Runs before every non-asset request:
 *  1. issues a per-request CSP nonce (Next.js reads it from the request CSP header);
 *  2. optimistically sends visitors without a session cookie to /login.
 * The session itself is validated in the console layout and in every Server
 * Action — this gate is only a fast path, never the authority.
 */
export function proxy(request: NextRequest): NextResponse {
  runtimeEnv ??= parseEnv(baseEnvSchema);
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    development: runtimeEnv.NODE_ENV === 'development',
    upgradeInsecureRequests: isHttps(request),
  });

  const { pathname, search } = request.nextUrl;
  if (!isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set('next', `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    redirect.headers.set('Content-Security-Policy', csp);
    return redirect;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
