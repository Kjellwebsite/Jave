import * as calendar from '../../calendar';
import type { CastKey } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/**
 * Events: a past kickoff with check-ins, a completed tournament with a full
 * bracket, and upcoming sessions with RSVPs (one with a waitlist).
 */

type RsvpChoice = 'going' | 'maybe' | 'declined';

async function respond(run: SeedRun, eventId: string, responses: [CastKey, RsvpChoice][]) {
  for (const [key, status] of responses) {
    await run.later(run.rng.int(5, 180));
    await calendar.rsvp(await run.as(key), { eventId, status });
  }
}

/** Open the event, let attendees check in with the code, then close it. */
async function holdEvent(run: SeedRun, host: CastKey, eventId: string, attendees: CastKey[]) {
  await calendar.markEventLive(await run.as(host), { eventId });
  const { code } = await calendar.generateCheckInCode(await run.as(host), { eventId });
  for (const key of attendees) {
    await run.later(run.rng.int(1, 8));
    await calendar.checkIn(await run.as(key), { eventId, code });
  }
}

/** Chapter 4 (70–60 days ago): the cohort kickoff. */
export function holdKickoff(story: Story): void {
  let eventId = '';
  story.at(-72, 12, async (run) => {
    const event = await calendar.scheduleEvent(await run.as('operations'), {
      title: 'Cohort Kickoff',
      description:
        'How JAVELIN works: trials, missions, ranks and what VERIFIED means. Bring one thing you shipped.',
      kind: 'meetup',
      startsAt: run.time(-68, 18),
      endsAt: run.time(-68, 20),
      location: 'JAVELIN Stage',
      capacity: 40,
    });
    eventId = event.id;
    await respond(run, eventId, [
      ['verified', 'going'],
      ['ilya', 'going'],
      ['noor', 'going'],
      ['leo', 'maybe'],
      ['priya', 'going'],
      ['mara', 'going'],
      ['sana', 'going'],
      ['aiko', 'declined'],
    ]);
  });
  story.at(-68, 17.75, (run) =>
    holdEvent(run, 'operations', eventId, ['verified', 'ilya', 'noor', 'priya', 'mara', 'sana']),
  );
  story.at(-68, 20.25, async (run) => {
    await calendar.completeEvent(await run.as('operations'), { eventId });
  });
}

/** Chapter 6 (48–41 days ago): the first JAVELIN Cup, played to a champion. */
export function playTournament(story: Story): void {
  let eventId = '';
  const squads: [string, CastKey[]][] = [
    ['Orbit', ['mara', 'ilya']],
    ['Tidewater', ['noor', 'leo']],
    ['Northline', ['verified', 'priya']],
    ['Signal', ['sana', 'aiko']],
    ['Foundry', ['kai', 'theo']],
  ];
  story.at(-48, 15, async (run) => {
    const event = await calendar.scheduleEvent(await run.as('operations'), {
      title: 'JAVELIN Cup: Systems Design',
      description:
        'Pairs design a system against a changing brief. Single elimination; judges score clarity and trade-offs.',
      kind: 'tournament',
      startsAt: run.time(-42, 17),
      endsAt: run.time(-42, 22),
      location: 'JAVELIN Arena',
      capacity: 16,
      rsvpClosesAt: run.time(-43, 12),
    });
    eventId = event.id;
    await respond(
      run,
      eventId,
      squads.flatMap(([, keys]) => keys.map((key): [CastKey, RsvpChoice] => [key, 'going'])),
    );
  });
  story.at(-43, 14, async (run) => {
    for (const [index, [name, keys]] of squads.entries()) {
      await calendar.createTeam(await run.as('operations'), {
        eventId,
        name,
        memberIds: run.memberIds(keys),
        seed: index + 1,
      });
    }
    await calendar.generateBracket(await run.as('operations'), { eventId, seeding: 'seeded' });
  });
  story.at(-42, 16.75, (run) =>
    holdEvent(
      run,
      'operations',
      eventId,
      squads.flatMap(([, keys]) => keys),
    ),
  );
  story.at(-42, 17.5, async (run) => {
    // Play round by round; the final completes the event.
    for (;;) {
      const bracket = await calendar.getBracket(await run.as('operations'), { eventId });
      const playable = bracket.rounds
        .flatMap((round) => round.matches)
        .filter((match) => match.status === 'ready' && match.teamA && match.teamB);
      if (playable.length === 0) break;
      for (const match of playable) {
        await run.later(run.rng.int(20, 35));
        const scoreA = run.rng.int(0, 3);
        const scoreB = run.rng.int(0, 3);
        await calendar.reportMatch(await run.as('theo'), {
          matchId: match.id,
          scoreA,
          scoreB,
          ...(scoreA === scoreB ? { winner: run.rng.pick(['a', 'b'] as const) } : {}),
        });
      }
    }
  });
}

/** Chapter 10 (10 days ago → now): upcoming sessions members are signing up for. */
export function scheduleUpcomingEvents(story: Story): void {
  let reviewNight = '';
  let buildSession = '';
  story.at(-10, 12, async (run) => {
    const event = await calendar.scheduleEvent(await run.as('operations'), {
      title: 'Research Review Night',
      description:
        'Three members present a paper they tried to break. Questions first, slides optional.',
      kind: 'talk',
      startsAt: run.time(3, 18),
      endsAt: run.time(3, 20),
      location: 'JAVELIN Stage',
      capacity: 30,
    });
    reviewNight = event.id;
  });
  story.at(-9, 10, (run) =>
    respond(run, reviewNight, [
      ['sana', 'going'],
      ['elif', 'going'],
      ['jun', 'going'],
      ['mara', 'maybe'],
      ['verified', 'going'],
      ['freya', 'going'],
      ['member', 'going'],
      ['core', 'going'],
      ['tomas', 'declined'],
    ]),
  );
  story.at(-6, 11, async (run) => {
    const event = await calendar.scheduleEvent(await run.as('theo'), {
      title: 'Build Session: Ship Something Small',
      description: 'Two focused hours. Pick a scoped task, ship it, demo it. Six seats.',
      kind: 'workshop',
      startsAt: run.time(6, 17),
      endsAt: run.time(6, 19),
      location: 'https://meet.example.org/javelin-build',
      capacity: 6,
      rsvpClosesAt: run.time(6, 12),
    });
    buildSession = event.id;
  });
  story.at(-5, 9, (run) =>
    respond(run, buildSession, [
      ['leo', 'going'],
      ['mateo', 'going'],
      ['ilya', 'going'],
      ['member', 'going'],
      ['priya', 'going'],
      ['noor', 'going'],
      ['elif', 'going'],
      ['omar', 'going'],
    ]),
  );
}
