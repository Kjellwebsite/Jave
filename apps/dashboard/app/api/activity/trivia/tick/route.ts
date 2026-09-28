import { handleArenaTick } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** Nudge overdue timers (the server enforces timing). */
export function POST(request: Request): Promise<Response> {
  return handleArenaTick(request, activityDeps());
}
