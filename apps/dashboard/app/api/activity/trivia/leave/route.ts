import { handleArenaLeave } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** Leave the lobby. */
export function POST(request: Request): Promise<Response> {
  return handleArenaLeave(request, activityDeps());
}
