import 'server-only';
import type { ServiceContext } from '@jave/core';
import { hashClientIp } from '@/server/auth/tokens';
import { clientIp } from '@/lib/request-security';
import type { ActivityDeps } from './deps';
import { errorResponse } from './http';

export type ActivityHandler = (request: Request, deps: ActivityDeps) => Promise<Response>;

/**
 * The envelope of every Activity endpoint: one context per request, and
 * every failure — surface, domain or unexpected — rendered as a JSON error.
 */
export function activityHandler(
  route: string,
  work: (request: Request, deps: ActivityDeps, ctx: ServiceContext) => Promise<Response>,
): ActivityHandler {
  return async (request, deps) => {
    const ctx = deps.context();
    try {
      return await work(request, deps, ctx);
    } catch (error) {
      return errorResponse(error, ctx, route);
    }
  };
}

/** Keyed hash of the caller's IP (raw addresses are never stored). */
export function clientKey(request: Request, deps: ActivityDeps): string {
  return hashClientIp(clientIp(request.headers), deps.sessionSecret);
}
