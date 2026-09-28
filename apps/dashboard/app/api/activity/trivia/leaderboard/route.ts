import { handleArenaBoard } from '../../_lib/handlers/arena-board';
import { activityDeps } from '../../_lib/runtime';

export const dynamic = 'force-dynamic';

/** The all-time trivia board as this viewer may see it. */
export function GET(request: Request): Promise<Response> {
  return handleArenaBoard(request, activityDeps());
}
