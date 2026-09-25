import { type NextRequest, NextResponse } from 'next/server';
import { OAUTH_STATE_COOKIE } from '@/lib/auth/cookie-names';
import { clientIp } from '@/lib/request-security';
import { baseContext } from '@/server/context';
import { buildAuthorizeUrl, oauthRedirectUri } from '@/server/auth/discord-oauth';
import type { LoginErrorCode } from '@/server/auth/login-errors';
import { createOAuthState, encodeOAuthState, OAUTH_STATE_TTL_MS } from '@/server/auth/oauth-state';
import { pkceChallenge } from '@/server/auth/pkce';
import { allowAuthAttempt } from '@/server/auth/rate-limits';
import { hashClientIp } from '@/server/auth/tokens';
import { getRuntime } from '@/server/runtime';
import { authCookieOptions } from '@/server/session-cookie';

export const dynamic = 'force-dynamic';

const OAUTH_COOKIE_PATH = '/api/auth';
const MS_PER_SECOND = 1000;

function toLogin(publicUrl: string, error: LoginErrorCode): NextResponse {
  const url = new URL('/login', publicUrl);
  url.searchParams.set('error', error);
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
}

/** Starts Discord OAuth2 (authorization code + PKCE). State lives in a signed, short-lived cookie. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { env } = getRuntime();
  if (!env.DISCORD_CLIENT_SECRET) return toLogin(env.JAVE_PUBLIC_URL, 'oauth_unavailable');
  const ctx = baseContext();
  const clientKey = hashClientIp(clientIp(request.headers), env.JAVE_SESSION_SECRET);
  if (!(await allowAuthAttempt(ctx, 'login', clientKey))) {
    return toLogin(env.JAVE_PUBLIC_URL, 'rate_limited');
  }
  const state = createOAuthState(request.nextUrl.searchParams.get('next'), ctx.clock.now());
  const response = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: env.DISCORD_CLIENT_ID,
      redirectUri: oauthRedirectUri(env.JAVE_PUBLIC_URL),
      state: state.state,
      codeChallenge: pkceChallenge(state.verifier),
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
  response.cookies.set(OAUTH_STATE_COOKIE, encodeOAuthState(state, env.JAVE_SESSION_SECRET), {
    ...authCookieOptions(),
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_MS / MS_PER_SECOND,
  });
  return response;
}
