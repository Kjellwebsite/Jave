/**
 * TEST DATA ONLY — Activity end-to-end fixtures.
 *
 * Provisions the dashboard's dev personas (MOCK / DEVELOPMENT ONLY) and gives
 * the VERIFIED persona a lived-in Mission Control: claims and verified ranks,
 * two missions, a running trial, an event in progress and upcoming events;
 * gives the MODERATOR more active missions than Mission Control lists; plays
 * finished Arena games among the staff personas (the founder's profile is
 * staff-only). Every write goes through a core service, so audit, history and
 * events are genuine.
 */
import {
  calendar,
  claimRank,
  createContext,
  DAY,
  HOUR,
  MINUTE,
  missions,
  resolveUserActor,
  type ServiceContext,
  setVerifiedRank,
  systemActor,
  trials,
  updateProfile,
  withActor,
} from '@jave/core';
import { createDatabase } from '@jave/database';
import { DEV_PERSONAS, provisionDevPersona } from '../../dashboard/server/auth/dev-personas';
import { seedArenaHistory } from './seed-arena';

const MISSION_HOURS = 72;
const URGENT_MISSION_HOURS = 18;
/** More than Mission Control lists (five), so it shows `5 OF 7`. */
const BACKLOG_MISSIONS = 7;
/** The event in progress started this long ago and runs for two hours. */
const LIVE_EVENT_STARTED_MS = 20 * MINUTE;
const LIVE_EVENT_LENGTH_MS = 2 * HOUR;
const TRIAL_MINUTES = 180;
const TRIAL_STATEMENT = 'I ship working software under pressure and I want to prove it here.';

async function asUser(system: ServiceContext, userId: string): Promise<ServiceContext> {
  return withActor(system, await resolveUserActor(system, userId));
}

function memberIdOf(ctx: ServiceContext): string {
  if (ctx.actor.kind !== 'user' || !ctx.actor.memberId) {
    throw new Error('seed actor has no member record');
  }
  return ctx.actor.memberId;
}

async function seedRanks(founder: ServiceContext, verified: ServiceContext): Promise<void> {
  const memberId = memberIdOf(verified);
  await updateProfile(verified, memberId, {
    headline: 'Flight software for small satellites. Ships on schedule.',
    primaryDomain: 'mind',
  });
  await claimRank(verified, { facetKey: 'mind.reasoning', rank: 'A' });
  await claimRank(verified, { facetKey: 'create.projects', rank: 'A' });
  await claimRank(verified, { facetKey: 'life.business', rank: 'C' });
  await setVerifiedRank(founder, {
    memberId,
    facetKey: 'mind.reasoning',
    rank: 'A',
    reason: 'Demonstrated in a proctored reasoning session.',
  });
  await setVerifiedRank(founder, {
    memberId,
    facetKey: 'create.technical',
    rank: 'B',
    reason: 'Shipped a reviewed flight-software module.',
  });
}

async function seedMissions(operations: ServiceContext, memberId: string): Promise<void> {
  const plans = [
    {
      title: 'Prototype sprint',
      brief: 'Ship a working prototype and document what you learned.',
      type: 'build' as const,
      durationHours: MISSION_HOURS,
    },
    {
      title: 'Paper teardown',
      brief: 'Read the assigned paper and write a one-page critique of its method.',
      type: 'research' as const,
      durationHours: URGENT_MISSION_HOURS,
    },
  ];
  for (const plan of plans) {
    const draft = await missions.createMission(operations, { ...plan, evidenceRequired: false });
    await missions.publishMission(operations, { missionId: draft.id, announce: false });
    await missions.assignMission(operations, { missionId: draft.id, memberIds: [memberId] });
  }
}

async function seedMissionBacklog(operations: ServiceContext, memberId: string): Promise<void> {
  for (let index = 1; index <= BACKLOG_MISSIONS; index++) {
    const draft = await missions.createMission(operations, {
      title: `Field report ${index}`,
      brief: 'File a short field report on what you built this week and what broke.',
      type: 'build',
      evidenceRequired: false,
      durationHours: index * 24,
    });
    await missions.publishMission(operations, { missionId: draft.id, announce: false });
    await missions.assignMission(operations, { missionId: draft.id, memberIds: [memberId] });
  }
}

async function seedTrial(operations: ServiceContext, players: ServiceContext[]): Promise<void> {
  const trial = await trials.createTrial(operations, {
    title: 'Night Build',
    category: 'build',
    summary: 'Build something that works before sunrise.',
    brief: 'MISSION\nShip a working tool for a real user before the deadline.',
    rubric: [
      { key: 'shipped', label: 'Working product', weight: 3 },
      { key: 'value', label: 'User value', weight: 1 },
    ],
    facetKeys: ['create.projects'],
    durationMinutes: TRIAL_MINUTES,
    teamSize: players.length,
  });
  await trials.openRecruitment(operations, { trialId: trial.id });
  for (const player of players) {
    await trials.applyToTrial(player, { trialId: trial.id, statement: TRIAL_STATEMENT });
  }
  await trials.selectParticipants(operations, {
    trialId: trial.id,
    mode: 'manual',
    memberIds: players.map(memberIdOf),
  });
  await trials.assignTeams(operations, { trialId: trial.id, strategy: 'random', seed: 'e2e' });
  await trials.startTrial(operations, { trialId: trial.id });
}

async function seedEvents(operations: ServiceContext, attendee: ServiceContext): Promise<void> {
  const now = operations.clock.now().getTime();
  const workshop = await calendar.scheduleEvent(operations, {
    title: 'Build night',
    kind: 'workshop',
    startsAt: new Date(now + DAY + 2 * HOUR),
    location: 'Lab 3, Berlin',
  });
  await calendar.scheduleEvent(operations, {
    title: 'Demo day',
    kind: 'talk',
    startsAt: new Date(now + 3 * DAY),
    location: 'https://meet.example.com/demo',
  });
  await calendar.rsvp(attendee, { eventId: workshop.id, status: 'going' });

  // Already running: scheduled from a clock set before its start, then taken live now.
  const startsAt = now - LIVE_EVENT_STARTED_MS;
  const earlier: ServiceContext = {
    ...operations,
    clock: { now: () => new Date(startsAt - MINUTE) },
  };
  const running = await calendar.scheduleEvent(earlier, {
    title: 'Orbit review',
    kind: 'talk',
    startsAt: new Date(startsAt),
    endsAt: new Date(startsAt + LIVE_EVENT_LENGTH_MS),
    location: 'Voice: Mission room',
  });
  await calendar.markEventLive(operations, { eventId: running.id });
}

export async function seedActivityFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-activity-e2e' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-seed') });
  try {
    const users = new Map<string, string>();
    for (const persona of DEV_PERSONAS) {
      users.set(persona.key, (await provisionDevPersona(system, persona)).id);
    }
    const persona = async (key: string) => asUser(system, users.get(key)!);
    const founder = await persona('founder');
    const operations = await persona('operations');
    const verified = await persona('verified');

    await seedRanks(founder, verified);
    await seedMissions(operations, memberIdOf(verified));
    await seedMissionBacklog(operations, memberIdOf(await persona('moderator')));
    await seedTrial(operations, [verified]);
    await seedEvents(operations, verified);
    await seedArenaHistory(system, users);
  } finally {
    await database.close();
  }
}
