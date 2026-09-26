import { handleMissionControl } from '../_lib/handlers/mission-control';
import { activityDeps } from '../_lib/runtime';

export const dynamic = 'force-dynamic';

/** Mission Control: the caller's profile summary, missions, trial and next events. */
export function GET(request: Request): Promise<Response> {
  return handleMissionControl(request, activityDeps());
}
