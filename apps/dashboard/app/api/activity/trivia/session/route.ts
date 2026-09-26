import { handleArenaOpen, handleArenaState } from '../../_lib/handlers/arena';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** The viewer's state of this instance's trivia session (polled). */
export function GET(request: Request): Promise<Response> {
  return handleArenaState(request, activityDeps());
}

/** Join this instance's lobby, or open one. */
export function POST(request: Request): Promise<Response> {
  return handleArenaOpen(request, activityDeps());
}
