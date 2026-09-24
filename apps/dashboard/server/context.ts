import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import {
  anonymousActor,
  createContext,
  resolveUserActor,
  type ServiceContext,
  type UserActor,
  withActor,
} from '@jave/core';
import { LOGIN_PATH } from '@/lib/routes';
import { type ValidSession, validateSession } from './auth/session-store';
import { getRuntime } from './runtime';
import { readSessionToken } from './session-cookie';

export interface RequestContext {
  ctx: ServiceContext;
  session: ValidSession | null;
}

export type UserContext = ServiceContext & { actor: UserActor };

export interface ConsoleContext {
  ctx: UserContext;
  actor: UserActor;
  session: ValidSession;
}

/** A fresh anonymous context (own request id) sharing the process-wide db, logger and cache. */
export function baseContext(): ServiceContext {
  const runtime = getRuntime();
  return createContext({
    db: runtime.database.db,
    actor: anonymousActor,
    logger: runtime.logger,
    cache: runtime.cache,
    config: runtime.coreConfig,
  });
}

/**
 * The ServiceContext for the current request: session cookie → session row →
 * actor with current roles and standing. Memoised per request render.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  // Read the cookie first: it marks the route dynamic before any runtime (env, db) is touched.
  const token = await readSessionToken();
  const ctx = baseContext();
  if (!token) return { ctx, session: null };
  const session = await validateSession(ctx, token);
  if (!session) return { ctx, session: null };
  const actor = await resolveUserActor(ctx, session.userId);
  return { ctx: withActor(ctx, actor), session };
});

export function isUserContext(ctx: ServiceContext): ctx is UserContext {
  return ctx.actor.kind === 'user';
}

/** For console pages: a signed-in user, or a redirect to /login. */
export async function requireConsoleContext(): Promise<ConsoleContext> {
  const { ctx, session } = await getRequestContext();
  if (!session || !isUserContext(ctx)) redirect(LOGIN_PATH);
  return { ctx, actor: ctx.actor, session };
}
