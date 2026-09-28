import 'server-only';
import {
  NotFoundError,
  resolveUserActor,
  type ServiceContext,
  type UserActor,
  withActor,
} from '@jave/core';
import type { ActivityDeps } from './deps';
import { bearerToken, unauthenticated } from './http';
import { type ActivityTokenClaims, verifyActivityToken } from './token';

export type ActivityUserContext = ServiceContext & { actor: UserActor };

export interface ActivityCaller {
  ctx: ActivityUserContext;
  claims: ActivityTokenClaims;
}

/**
 * Bearer token → user actor with current roles and standing. A token minted
 * by dev login stops working the moment dev auth is switched off. The token
 * never authorizes anything by itself: every service re-checks the actor.
 */
export async function authenticate(
  request: Request,
  deps: ActivityDeps,
  base: ServiceContext,
): Promise<ActivityCaller> {
  const token = bearerToken(request);
  if (!token) throw unauthenticated();
  const claims = verifyActivityToken(token, deps.sessionSecret, base.clock.now());
  if (!claims) throw unauthenticated();
  if (claims.mode === 'dev' && !deps.devAuthEnabled) throw unauthenticated();
  let actor: UserActor;
  try {
    actor = await resolveUserActor(base, claims.sub);
  } catch (error) {
    if (error instanceof NotFoundError) throw unauthenticated();
    throw error;
  }
  return { ctx: withActor(base, actor) as ActivityUserContext, claims };
}
