'use server';

import { redirect } from 'next/navigation';
import { systemActor, withActor, withTransaction } from '@jave/core';
import { formString } from '@/lib/form-data';
import { LOGIN_PATH, safeNextPath } from '@/lib/routes';
import { findDevPersona, isDevAuthEnabled, provisionDevPersona } from '../auth/dev-auth';
import { allowAuthAttempt } from '../auth/rate-limits';
import { endSession, startSession } from '../auth/sign-in';
import { baseContext } from '../context';
import { currentClientIpHash, currentUserAgent, isTrustedMutationRequest } from '../request';
import { getRuntime } from '../runtime';
import { clearSessionCookie, readSessionToken, writeSessionCookie } from '../session-cookie';

function loginWithError(code: string): never {
  redirect(`${LOGIN_PATH}?error=${encodeURIComponent(code)}`);
}

/**
 * DEV LOGIN — MOCK / DEVELOPMENT ONLY. Signs in as a deterministic fake
 * persona. Refused unless JAVE_DEV_AUTH=true and NODE_ENV is not production.
 */
export async function devLoginAction(data: FormData): Promise<void> {
  const { env } = getRuntime();
  if (!isDevAuthEnabled(env)) loginWithError('dev_auth_disabled');
  if (!(await isTrustedMutationRequest())) loginWithError('origin');
  const persona = findDevPersona(formString(data, 'persona'));
  if (!persona) loginWithError('dev_auth_disabled');

  const ctx = withActor(baseContext(), systemActor('dev-login'));
  const ipHash = await currentClientIpHash();
  if (!(await allowAuthAttempt(ctx, 'devLogin', ipHash))) loginWithError('rate_limited');

  const user = await withTransaction(ctx, (tx) => provisionDevPersona(tx, persona));
  const session = await startSession(ctx, {
    userId: user.id,
    previousToken: await readSessionToken(),
    userAgent: await currentUserAgent(),
    ipHash,
    audit: { action: 'auth.dev_login', context: { persona: persona.key, mock: true } },
  });
  // Only after the session and its audit entry have committed.
  await writeSessionCookie(session);
  redirect(safeNextPath(formString(data, 'next')));
}

/** Revokes the current session server-side (audited auth.logout), then clears the cookie. */
export async function signOutAction(): Promise<void> {
  if (!(await isTrustedMutationRequest())) return;
  const token = await readSessionToken();
  // Throws if the revocation cannot commit: the cookie is then kept, never
  // cleared while its session stays valid on the server.
  if (token) await endSession(baseContext(), token);
  await clearSessionCookie();
  redirect(LOGIN_PATH);
}
