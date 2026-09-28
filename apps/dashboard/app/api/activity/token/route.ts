import { handleTokenExchange } from '../_lib/handlers/auth';
import { activityDeps } from '../_lib/runtime';

export const dynamic = 'force-dynamic';

/** Discord Activity sign-in: authorization code → Discord access token + JAVE token. */
export function POST(request: Request): Promise<Response> {
  return handleTokenExchange(request, activityDeps());
}
