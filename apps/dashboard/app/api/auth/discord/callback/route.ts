import { type NextRequest, NextResponse } from 'next/server';
import {
  type DiscordProfile,
  ensureMember,
  recordAudit,
  resolveUserActor,
  safeEqual,
  systemActor,
  upsertDiscordUser,
  withActor,
  withTransaction,
} from '@jave/core';
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from '@/lib/auth/cookie-names';
import { clientIp } from '@/lib/request-security';
import { baseContext } from '@/server/context';
import { createDiscordOAuthClient, oauthRedirectUri } from '@/server/auth/discord-oauth';
import type { LoginErrorCode } from '@/server/auth/login-errors';
import { decodeOAuthState } from '@/server/auth/oauth-state';
import { allowAuthAttempt } from '@/server/auth/rate-limits';
import { createSession, revokeSession } from '@/server/auth/session-store';
import { hashClientIp } from '@/server/auth/tokens';
import { getRuntime } from '@/server/runtime';
import { authCookieOptions } from '@/server/session-cookie';

export const dynamic = 'force-dynamic';

const OAUTH_COOKIE_PATH = '/api/auth';
const MAX_CODE_LENGTH = 512;

function withClearedState(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    ...authCookieOptions(),
    path: OAUTH_COOKIE_PATH,
    maxAge: 0,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function toLogin(publicUrl: string, error: LoginErrorCode): NextResponse {
  const url = new URL('/login', publicUrl);
  url.searchParams.set('error', error);
  return withClearedState(NextResponse.redirect(url));
}

/**
 * Discord OAuth2 callback: verify state (constant time) → exchange the code
 * with the PKCE verifier → fetch /users/@me → upsert user + member → session.
 * Discord tokens are used once and never stored or logged.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { env } = getRuntime();
  const ctx = baseContext();
  const ipHash = hashClientIp(clientIp(request.headers), env.JAVE_SESSION_SECRET);
  if (!(await allowAuthAttempt(ctx, 'callback', ipHash))) {
    return toLogin(env.JAVE_PUBLIC_URL, 'rate_limited');
  }

  const params = request.nextUrl.searchParams;
  const stored = decodeOAuthState(
    request.cookies.get(OAUTH_STATE_COOKIE)?.value,
    env.JAVE_SESSION_SECRET,
    ctx.clock.now(),
  );
  const returnedState = params.get('state');
  if (!stored || !returnedState || !safeEqual(returnedState, stored.state)) {
    return toLogin(env.JAVE_PUBLIC_URL, 'oauth_state');
  }
  if (params.has('error')) return toLogin(env.JAVE_PUBLIC_URL, 'oauth_denied');
  const code = params.get('code');
  if (!code || code.length > MAX_CODE_LENGTH) return toLogin(env.JAVE_PUBLIC_URL, 'oauth_failed');
  if (!env.DISCORD_CLIENT_SECRET) return toLogin(env.JAVE_PUBLIC_URL, 'oauth_unavailable');

  const discord = createDiscordOAuthClient({
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
  });
  let profile: DiscordProfile;
  try {
    const accessToken = await discord.exchangeCode({
      code,
      codeVerifier: stored.verifier,
      redirectUri: oauthRedirectUri(env.JAVE_PUBLIC_URL),
    });
    profile = await discord.fetchProfile(accessToken);
  } catch (error) {
    ctx.logger.warn(
      { reason: error instanceof Error ? error.message : 'unknown' },
      'discord oauth exchange failed',
    );
    return toLogin(env.JAVE_PUBLIC_URL, 'oauth_failed');
  }
  if (profile.isBot) return toLogin(env.JAVE_PUBLIC_URL, 'oauth_failed');

  const provisioning = withActor(ctx, systemActor('discord-oauth-login'));
  const user = await withTransaction(provisioning, async (tx) => {
    const record = await upsertDiscordUser(tx, profile);
    // A dashboard login never implies guild membership; an existing member row is left as is.
    await ensureMember(tx, record, { inGuild: false });
    return record;
  });
  // Rotate: a new sign-in never leaves a previous session in this browser alive.
  const previous = request.cookies.get(SESSION_COOKIE)?.value;
  if (previous) await revokeSession(ctx, previous);
  const session = await createSession(ctx, {
    userId: user.id,
    userAgent: request.headers.get('user-agent'),
    ipHash,
  });
  await recordAudit(withActor(ctx, await resolveUserActor(ctx, user.id)), {
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    context: { method: 'discord_oauth' },
  });

  const response = NextResponse.redirect(new URL(stored.next, env.JAVE_PUBLIC_URL));
  response.cookies.set(SESSION_COOKIE, session.token, {
    ...authCookieOptions(),
    path: '/',
    expires: session.expiresAt,
  });
  return withClearedState(response);
}
