import { handleArenaClose } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** The host (or event staff) closes the lobby. */
export function POST(request: Request): Promise<Response> {
  return handleArenaClose(request, activityDeps());
}
