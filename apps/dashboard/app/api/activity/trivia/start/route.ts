import { handleArenaStart } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** The host starts the lobby. */
export function POST(request: Request): Promise<Response> {
  return handleArenaStart(request, activityDeps());
}
