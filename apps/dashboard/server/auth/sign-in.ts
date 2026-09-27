import 'server-only';
import {
  recordAudit,
  resolveUserActor,
  type ServiceContext,
  withActor,
  withTransaction,
} from '@jave/core';
import { createSession, type NewSession, revokeSession } from './session-store';

export type SignInAudit =
  | { action: 'auth.login'; context: { method: 'discord_oauth' } }
  | { action: 'auth.dev_login'; context: { persona: string; mock: true } };

export interface StartSessionInput {
  userId: string;
  /** The browser's current session token, if any: revoked, so a sign-in always rotates. */
  previousToken?: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
  audit: SignInAudit;
}

/**
 * Signs a user in. Rotating out the previous session, creating the new one
 * and recording the sign-in audit entry commit together or not at all
 * (ARCHITECTURE: state change + recordAudit in one transaction). The caller
 * sets the cookie only after this resolves, so a browser never holds a
 * session whose audit entry was rolled back.
 */
export async function startSession(
  ctx: ServiceContext,
  input: StartSessionInput,
): Promise<NewSession> {
  return withTransaction(ctx, async (tx) => {
    if (input.previousToken) await revokeSession(tx, input.previousToken);
    const session = await createSession(tx, {
      userId: input.userId,
      userAgent: input.userAgent,
      ipHash: input.ipHash,
    });
    await recordAudit(withActor(tx, await resolveUserActor(tx, input.userId)), {
      action: input.audit.action,
      targetType: 'user',
      targetId: input.userId,
      context: input.audit.context,
    });
    return session;
  });
}

/**
 * Signs out: revokes the session behind `token` and records `auth.logout` in
 * one transaction. Null when the session was not live (nothing to audit).
 * If the transaction fails the session stays valid and the error propagates,
 * so the caller must not clear the cookie as if sign-out had succeeded.
 */
export async function endSession(
  ctx: ServiceContext,
  token: string,
): Promise<{ userId: string; sessionId: string } | null> {
  return withTransaction(ctx, async (tx) => {
    const revoked = await revokeSession(tx, token);
    if (!revoked) return null;
    await recordAudit(withActor(tx, await resolveUserActor(tx, revoked.userId)), {
      action: 'auth.logout',
      targetType: 'user',
      targetId: revoked.userId,
    });
    return revoked;
  });
}
