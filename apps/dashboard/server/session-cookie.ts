import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth/cookie-names';
import { getRuntime } from './runtime';
import type { NewSession } from './auth/session-store';

/** Cookie flags shared by every auth cookie: httpOnly, lax, secure in production. */
export function authCookieOptions(): { httpOnly: true; sameSite: 'lax'; secure: boolean } {
  return { httpOnly: true, sameSite: 'lax', secure: getRuntime().env.NODE_ENV === 'production' };
}

export async function readSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Only callable from Server Actions and Route Handlers (cookies cannot be set while streaming). */
export async function writeSessionCookie(session: NewSession): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    ...authCookieOptions(),
    path: '/',
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { ...authCookieOptions(), path: '/', maxAge: 0 });
}
