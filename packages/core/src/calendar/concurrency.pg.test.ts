import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY } from '../kernel/clock';
import { InvalidStateError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { getEvent, scheduleEvent } from './events.service';
import { rsvp } from './rsvp.service';
import { createTeam } from './teams.service';
import { generateBracket, getBracket, reportMatch } from './tournament.service';
import { createPostgresKit, POSTGRES_TEST_URL_VARIABLE, type PostgresKit } from './test-postgres';

const postgresUrl = process.env[POSTGRES_TEST_URL_VARIABLE];
const SETUP_TIMEOUT_MS = 120_000;
const BURST = 12;
const CAPACITY = 3;
const DUPLICATE_REPORTS = 4;

/**
 * Real interleaving on a real Postgres (opt-in, see `POSTGRES_TEST_URL_VARIABLE`):
 * every call below runs its transaction on its own pooled connection at the
 * same time, so a missing row lock shows up as a broken invariant.
 */
describe.skipIf(!postgresUrl)('calendar row locks on real Postgres', () => {
  let kit: PostgresKit;
  let staff: UserActor;

  beforeAll(async () => {
    kit = await createPostgresKit(postgresUrl!);
    staff = await kit.member(['operations']);
  }, SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await kit?.close();
  });

  const tomorrow = () => new Date(kit.clock.now().getTime() + DAY);

  it('concurrent RSVPs never exceed capacity', async () => {
    const event = await scheduleEvent(kit.as(staff), {
      title: 'Lock Night',
      kind: 'meetup',
      startsAt: tomorrow(),
      capacity: CAPACITY,
    });
    const people: UserActor[] = [];
    for (let i = 0; i < BURST; i++) people.push(await kit.member());
    const results = await Promise.all(
      people.map((person) => rsvp(kit.as(person), { eventId: event.id, status: 'going' })),
    );
    expect(results.filter((r) => r.status === 'going')).toHaveLength(CAPACITY);
    expect(results.filter((r) => r.status === 'waitlist')).toHaveLength(BURST - CAPACITY);
    expect((await getEvent(kit.system, { eventId: event.id })).counts.going).toBe(CAPACITY);
    // Once the burst has committed, the waitlist is one strict order: 1..n, no ties.
    // (A position returned mid-burst is a snapshot: same-millisecond responses are
    // ordered by row id, so one committing later can still move ahead.)
    const positions: number[] = [];
    for (const person of people) {
      const mine = (await getEvent(kit.as(person), { eventId: event.id })).myRsvp;
      if (mine?.waitlistPosition) positions.push(mine.waitlistPosition);
    }
    expect(positions.sort((a, b) => a - b)).toEqual(
      Array.from({ length: BURST - CAPACITY }, (_, i) => i + 1),
    );
  });

  it('concurrent reports of one match record exactly one result', async () => {
    const event = await scheduleEvent(kit.as(staff), {
      title: 'Lock Cup',
      kind: 'tournament',
      startsAt: tomorrow(),
    });
    for (let i = 1; i <= 2; i++) {
      const player = await kit.member();
      await createTeam(kit.as(staff), {
        eventId: event.id,
        name: `Squad ${i}`,
        memberIds: [player.memberId!],
      });
    }
    const bracket = await generateBracket(kit.as(staff), { eventId: event.id });
    const final = bracket.rounds[0]!.matches[0]!;
    const outcomes = await Promise.allSettled(
      Array.from({ length: DUPLICATE_REPORTS }, (_, i) =>
        reportMatch(kit.as(staff), { matchId: final.id, winner: i % 2 ? 'a' : 'b' }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes.filter((o) => o.status === 'rejected')) {
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);
    }
    expect((await getBracket(kit.system, { eventId: event.id })).state).toBe('completed');
  });
});
