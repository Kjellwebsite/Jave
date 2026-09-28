import { handleDevPersonas, handleDevToken } from '../_lib/handlers/auth';
import { activityDeps } from '../_lib/runtime';

export const dynamic = 'force-dynamic';

/** MOCK / DEVELOPMENT ONLY — persona list for the standalone dev bar. 404 unless enabled. */
export function GET(request: Request): Promise<Response> {
  return handleDevPersonas(request, activityDeps());
}

/** MOCK / DEVELOPMENT ONLY — persona sign-in without Discord. 404 unless enabled. */
export function POST(request: Request): Promise<Response> {
  return handleDevToken(request, activityDeps());
}
