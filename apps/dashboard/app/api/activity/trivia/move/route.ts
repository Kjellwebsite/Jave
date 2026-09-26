import { handleArenaMove } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** Lock in an answer for the open round. */
export function POST(request: Request): Promise<Response> {
  return handleArenaMove(request, activityDeps());
}
