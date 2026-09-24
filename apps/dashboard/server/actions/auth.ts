'use server';

import { redirect } from 'next/navigation';
import { recordAudit, resolveUserActor, systemActor, withActor, withTransaction } from '@jave/core';
import { formString } from '@/lib/form-data';
import { LOGIN_PATH, safeNextPath } from '@/lib/routes';
import { findDevPersona, isDevAuthEnabled, provisionDevPersona } from '../auth/dev-auth';
import { allowAuthAttempt } from '../auth/rate-limits';
import { createSession, revokeSession } from '../auth/session-store';
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
  // Rotate: a new sign-in never leaves a previous session in this browser alive.
  const previous = await readSessionToken();
  if (previous) await revokeSession(ctx, previous);
  const session = await createSession(ctx, {
    userId: user.id,
    userAgent: await currentUserAgent(),
    ipHash,
  });
  await writeSessionCookie(session);
  await recordAudit(withActor(ctx, await resolveUserActor(ctx, user.id)), {
    action: 'auth.dev_login',
    targetType: 'user',
    targetId: user.id,
    context: { persona: persona.key, mock: true },
  });
  redirect(safeNextPath(formString(data, 'next')));
}

/** Revokes the current session server-side, clears the cookie, audits auth.logout. */
export async function signOutAction(): Promise<void> {
  if (!(await isTrustedMutationRequest())) return;
  const token = await readSessionToken();
  if (token) {
    const ctx = baseContext();
    const revoked = await revokeSession(ctx, token);
    if (revoked) {
      await recordAudit(withActor(ctx, await resolveUserActor(ctx, revoked.userId)), {
        action: 'auth.logout',
        targetType: 'user',
        targetId: revoked.userId,
      });
    }
  }
  await clearSessionCookie();
  redirect(LOGIN_PATH);
}
