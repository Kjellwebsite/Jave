import 'server-only';
import {
  calendar,
  can,
  ForbiddenError,
  getProfile,
  missions,
  NotFoundError,
  trials,
} from '@jave/core';
import { authenticate, type ActivityUserContext } from '../auth';
import type { MissionControlResponse } from '../contract';
import { activityHandler } from '../handler';
import { json } from '../http';
import { spendActivityBudget } from '../limits';
import {
  pickCurrentTrial,
  toEventWire,
  toMissionWire,
  toProfileWire,
} from '../mappers/mission-control';

/** Mission Control shows the next few items; the dashboard has the full lists. */
export const MISSION_CONTROL_MISSIONS = 5;
export const MISSION_CONTROL_EVENTS = 3;

/**
 * A panel the viewer may not see (e.g. a restricted account) renders empty
 * instead of failing the whole screen. Anything unexpected still fails.
 */
async function section<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return fallback;
    throw error;
  }
}

function canHostGames(ctx: ActivityUserContext): boolean {
  return ctx.actor.memberId !== null && ctx.actor.standing === 'good' && can(ctx, 'canHostGames');
}

/**
 * GET /api/activity/me — the caller's own Mission Control: profile summary
 * (domain ranks with VERIFIED / CLAIMED / UNKNOWN), active missions, the
 * current trial (member-safe summary only) and the next events.
 */
export const handleMissionControl = activityHandler('activity.me', async (request, deps, base) => {
  const { ctx } = await authenticate(request, deps, base);
  await spendActivityBudget(ctx, 'me', ctx.actor.userId);
  const memberId = ctx.actor.memberId;
  const empty: MissionControlResponse = {
    serverNow: ctx.clock.now().getTime(),
    profile: null,
    missions: [],
    trial: null,
    events: [],
    canHostGames: false,
  };
  if (!memberId) return json(empty);

  const [profile, activeMissions, trialHistory, upcoming] = await Promise.all([
    section(() => getProfile(ctx, { memberId }), null),
    section(() => missions.listMyMissions(ctx, { scope: 'active' }), []),
    section(() => trials.myTrials(ctx), []),
    section(
      async () =>
        (await calendar.listEvents(ctx, { scope: 'upcoming', limit: MISSION_CONTROL_EVENTS }))
          .items,
      [],
    ),
  ]);
  return json<MissionControlResponse>({
    ...empty,
    profile: profile ? toProfileWire(profile) : null,
    missions: activeMissions.slice(0, MISSION_CONTROL_MISSIONS).map(toMissionWire),
    trial: pickCurrentTrial(trialHistory),
    events: upcoming.map(toEventWire),
    canHostGames: canHostGames(ctx),
  });
});
