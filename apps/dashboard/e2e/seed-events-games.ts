/**
 * End-to-end fixtures for events, tournaments and games — TEST DATA ONLY.
 * Events go through the calendar services (past ones with a clock set in the
 * past), so RSVPs, waitlists, check-ins, teams and brackets are genuine.
 * Finished game sessions are inserted as records: playing a whole seeded
 * game here would only re-test the engine.
 */
import { inArray } from 'drizzle-orm';
import {
  calendar,
  type Clock,
  createContext,
  DAY,
  HOUR,
  ManualClock,
  MINUTE,
  randomToken,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  withActor,
} from '@jave/core';
import { createDatabase, gamePlayers, gameSessions, members } from '@jave/database';

export const EVENT_FIXTURES = {
  meetup: 'Build Night',
  tournament: 'Autumn Cup',
  live: 'Office Hours',
  past: 'Rocketry Workshop',
  cancelled: 'Summer Social',
} as const;

const GAME_SEED_BYTES = 24;

interface Actors {
  system: ServiceContext;
  as(handle: string, clock?: Clock): Promise<ServiceContext>;
  memberId(handle: string): string;
}

async function actors(system: ServiceContext, handles: readonly string[]): Promise<Actors> {
  const rows = await system.db
    .select({ id: members.id, userId: members.userId, handle: members.handle })
    .from(members)
    .where(inArray(members.handle, [...handles]));
  const byHandle = new Map(rows.map((row) => [row.handle, row]));
  const row = (handle: string) => {
    const found = byHandle.get(handle);
    if (!found) throw new Error(`fixture member @${handle} is missing`);
    return found;
  };
  return {
    system,
    async as(handle, clock) {
      const base = clock ? { ...system, clock } : system;
      return withActor(base, await resolveUserActor(base, row(handle).userId));
    },
    memberId: (handle) => row(handle).id,
  };
}

async function respond(
  cast: Actors,
  eventId: string,
  answers: Record<string, 'going' | 'maybe' | 'declined'>,
  clock?: Clock,
) {
  for (const [handle, status] of Object.entries(answers)) {
    await calendar.rsvp(await cast.as(handle, clock), { eventId, status });
  }
}

/** Tomorrow-or-later at a round hour, so fixtures read like real schedules. */
function daysAhead(now: Date, days: number, hourUtc: number): Date {
  const date = new Date(now.getTime() + days * DAY);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

async function seedMeetup(cast: Actors, now: Date) {
  const ops = await cast.as('dev_operations');
  const event = await calendar.scheduleEvent(ops, {
    title: EVENT_FIXTURES.meetup,
    kind: 'meetup',
    description:
      'Hardware and software builders, one room, four hours. Bring what you are shipping this month; leave with one thing unblocked.\n\nDoors open 30 minutes early for check-in.',
    startsAt: daysAhead(now, 3, 17),
    endsAt: daysAhead(now, 3, 21),
    location: 'https://example.org/javelin/build-night',
    capacity: 5,
  });
  await respond(cast, event.id, {
    mara: 'going',
    sana: 'going',
    elena: 'going',
    jun: 'going',
    ren: 'maybe',
    ilya: 'declined',
    dev_verified: 'going',
    theo: 'going',
  });
}

const TEAMS = [
  'Apogee',
  'Perigee',
  'Vector',
  'Delta-V',
  'Ion Drive',
  'Kepler',
  'Lagrange',
  'Nadir',
];
const PLAYERS = ['mara', 'sana', 'theo', 'elena', 'ren', 'jun', 'ilya', 'dev_verified'];
const QUARTERFINAL_SCORES: readonly [number, number][] = [
  [3, 1],
  [2, 0],
  [1, 2],
];

async function seedTournament(cast: Actors, now: Date) {
  const ops = await cast.as('dev_operations');
  const event = await calendar.scheduleEvent(ops, {
    title: EVENT_FIXTURES.tournament,
    kind: 'tournament',
    description: 'Eight teams, single elimination, best of three. Seeds from the spring ladder.',
    startsAt: daysAhead(now, 5, 16),
    endsAt: daysAhead(now, 5, 22),
    location: 'Lab 3, north wing',
    capacity: 16,
  });
  await respond(
    cast,
    event.id,
    Object.fromEntries(PLAYERS.map((handle) => [handle, 'going' as const])),
  );
  for (const [index, name] of TEAMS.entries()) {
    await calendar.createTeam(ops, {
      eventId: event.id,
      name,
      memberIds: [cast.memberId(PLAYERS[index]!)],
      seed: index + 1,
    });
  }
  const bracket = await calendar.generateBracket(ops, { eventId: event.id, seeding: 'seeded' });
  const quarterfinals = bracket.rounds[0]!.matches;
  for (const [index, [scoreA, scoreB]] of QUARTERFINAL_SCORES.entries()) {
    await calendar.reportMatch(ops, { matchId: quarterfinals[index]!.id, scoreA, scoreB });
  }
}

async function seedLive(cast: Actors, now: Date) {
  const ops = await cast.as('dev_operations');
  const event = await calendar.scheduleEvent(ops, {
    title: EVENT_FIXTURES.live,
    kind: 'session',
    description: 'Open review of trial submissions. Drop in with questions.',
    startsAt: new Date(now.getTime() + 10 * MINUTE),
    endsAt: new Date(now.getTime() + 2 * HOUR),
  });
  await respond(cast, event.id, { mara: 'going', ilya: 'going', noor: 'maybe' });
  await calendar.markEventLive(ops, { eventId: event.id });
}

async function seedPast(cast: Actors, now: Date) {
  const start = new Date(now.getTime() - 10 * DAY);
  const clock = new ManualClock(new Date(start.getTime() - 2 * DAY));
  const ops = await cast.as('dev_operations', clock);
  const event = await calendar.scheduleEvent(ops, {
    title: EVENT_FIXTURES.past,
    kind: 'workshop',
    description: 'Motor casting, igniters and a static fire at the range.',
    startsAt: start,
    endsAt: new Date(start.getTime() + 3 * HOUR),
    location: 'Range B',
    capacity: 12,
  });
  await respond(
    cast,
    event.id,
    { mara: 'going', sana: 'going', theo: 'going', jun: 'going', elena: 'maybe' },
    clock,
  );
  clock.set(new Date(start.getTime() - 5 * MINUTE));
  const issued = await calendar.generateCheckInCode(ops, { eventId: event.id });
  for (const handle of ['mara', 'sana', 'jun']) {
    await calendar.checkIn(await cast.as(handle, clock), {
      eventId: event.id,
      code: issued.code,
    });
  }
  clock.set(new Date(start.getTime() + 3 * HOUR));
  await calendar.completeEvent(ops, { eventId: event.id });

  const cancelledClock = new ManualClock(new Date(now.getTime() - 40 * DAY));
  const opsThen = await cast.as('dev_operations', cancelledClock);
  const social = await calendar.scheduleEvent(opsThen, {
    title: EVENT_FIXTURES.cancelled,
    kind: 'social',
    startsAt: new Date(now.getTime() - 30 * DAY),
  });
  await respond(cast, social.id, { sol: 'going', elena: 'going' }, cancelledClock);
  await calendar.cancelEvent(opsThen, {
    eventId: social.id,
    reason: 'Venue unavailable. Folded into the autumn meetup.',
  });
}

/** Finished sessions: [game, [handle, score][] in placement order]. */
const GAME_RESULTS: readonly [string, readonly [string, number][]][] = [
  [
    'trivia',
    [
      ['mara', 620],
      ['sana', 540],
      ['theo', 300],
      ['jun', 0],
    ],
  ],
  [
    'trivia',
    [
      ['sana', 700],
      ['mara', 650],
      ['elena', 420],
    ],
  ],
  [
    'trivia',
    [
      ['mara', 560],
      ['sol', 480],
      ['dev_verified', 210],
    ],
  ],
  [
    'reaction',
    [
      ['jun', 280],
      ['mara', 250],
      ['ilya', 90],
    ],
  ],
  ['trivia', [['dev_member', 900]]],
];

async function seedGames(cast: Actors, now: Date) {
  const userIds = new Map<string, string>();
  for (const [, results] of GAME_RESULTS) {
    for (const [handle] of results) {
      const ctx = await cast.as(handle);
      if (ctx.actor.kind === 'user') userIds.set(handle, ctx.actor.userId);
    }
  }
  for (const [index, [gameKey, results]] of GAME_RESULTS.entries()) {
    const endedAt = new Date(now.getTime() - (index + 1) * DAY);
    const [session] = await cast.system.db
      .insert(gameSessions)
      .values({
        gameKey,
        status: 'completed',
        surface: 'dashboard',
        hostUserId: userIds.get(results[0]![0])!,
        seed: randomToken(GAME_SEED_BYTES),
        version: results.length + 2,
        playerCount: results.length,
        lastActivityAt: endedAt,
        startedAt: new Date(endedAt.getTime() - 10 * MINUTE),
        endedAt,
      })
      .returning({ id: gameSessions.id });
    await cast.system.db.insert(gamePlayers).values(
      results.map(([handle, score], seat) => ({
        sessionId: session!.id,
        userId: userIds.get(handle)!,
        seat: seat + 1,
        score,
        placement: seat + 1,
        joinedAt: new Date(endedAt.getTime() - 15 * MINUTE),
      })),
    );
  }
}

export async function seedEventsAndGames(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-seed-events' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-seed-events') });
  const now = system.clock.now();
  try {
    const handles = [...new Set([...PLAYERS, 'noor', 'sol', 'dev_operations', 'dev_member'])];
    const cast = await actors(system, handles);
    await seedMeetup(cast, now);
    await seedTournament(cast, now);
    await seedLive(cast, now);
    await seedPast(cast, now);
    await seedGames(cast, now);
  } finally {
    await database.close();
  }
}
