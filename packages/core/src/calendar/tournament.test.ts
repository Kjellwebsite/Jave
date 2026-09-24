import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { domainEvents } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { DAY } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { getEvent, scheduleEvent, updateEvent } from './events.service';
import { rsvp } from './rsvp.service';
import { createRandomTeams, createTeam, deleteTeam, listTeams } from './teams.service';
import { generateBracket, getBracket, reportMatch, type BracketView } from './tournament.service';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from './test-support';

describe('teams and tournaments', () => {
  let kit: TestKit;
  let staff: UserActor;

  beforeAll(warmUpTestDatabase, SNAPSHOT_BUILD_TIMEOUT_MS);
  beforeEach(async () => {
    kit = await createTestKit();
    staff = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  const tournament = () =>
    scheduleEvent(kit.as(staff), {
      title: 'Logic Cup',
      kind: 'tournament',
      startsAt: new Date(kit.clock.now().getTime() + DAY),
    });

  async function teams(eventId: string, count: number) {
    const created = [];
    for (let i = 1; i <= count; i++) {
      const player = await kit.member();
      created.push(
        await createTeam(kit.as(staff), {
          eventId,
          name: `Squad ${i}`,
          memberIds: [player.memberId!],
          seed: i,
        }),
      );
    }
    return created;
  }

  const matchesIn = (bracket: BracketView, round: number) =>
    bracket.rounds.find((r) => r.round === round)!.matches;

  describe('teams', () => {
    it('creates manual teams; a member sits on one team per event', async () => {
      const event = await tournament();
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      const team = await createTeam(kit.as(staff), {
        eventId: event.id,
        name: 'Vector',
        memberIds: [a.memberId!, b.memberId!],
      });
      expect(team.members.map((m) => m.memberId).sort()).toEqual([a.memberId!, b.memberId!].sort());
      await expect(
        createTeam(kit.as(staff), { eventId: event.id, name: 'Scalar', memberIds: [a.memberId!] }),
      ).rejects.toBeInstanceOf(ConflictError);
      const c = await kit.member();
      await expect(
        createTeam(kit.as(staff), { eventId: event.id, name: 'Vector', memberIds: [c.memberId!] }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        createTeam(kit.as(staff), {
          eventId: event.id,
          name: 'Ghosts',
          memberIds: ['00000000-0000-4000-8000-000000000000'],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        createTeam(kit.as(staff), {
          eventId: event.id,
          name: 'Dupes',
          memberIds: [c.memberId!, c.memberId!],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('draws random teams from going RSVPs, deterministically per seed', async () => {
      const event = await tournament();
      for (let i = 0; i < 7; i++) {
        const player = await kit.member();
        await rsvp(kit.as(player), { eventId: event.id, status: 'going' });
      }
      const declined = await kit.member();
      await rsvp(kit.as(declined), { eventId: event.id, status: 'declined' });
      const draw = async (seed: string) => {
        const drawn = await createRandomTeams(kit.as(staff), {
          eventId: event.id,
          teamSize: 3,
          seed,
        });
        for (const team of drawn) await deleteTeam(kit.as(staff), { teamId: team.id });
        return drawn.map((t) => ({
          name: t.name,
          members: t.members.map((m) => m.memberId).sort(),
        }));
      };
      const first = await draw('cup-2026');
      expect(await draw('cup-2026')).toEqual(first);
      expect(await draw('other-seed')).not.toEqual(first);
      expect(first.map((t) => t.name)).toEqual(['Team 01', 'Team 02', 'Team 03']);
      expect(first.map((t) => t.members.length).sort()).toEqual([2, 2, 3]);
      const drawnIds = first.flatMap((t) => t.members);
      expect(new Set(drawnIds).size).toBe(7);
      expect(drawnIds).not.toContain(declined.memberId);
    });

    it('draws only members not yet on a team, and refuses an empty pool', async () => {
      const event = await tournament();
      const people = await Promise.all([1, 2, 3].map(() => kit.member()));
      for (const p of people) await rsvp(kit.as(p), { eventId: event.id, status: 'going' });
      await createTeam(kit.as(staff), {
        eventId: event.id,
        name: 'Preset',
        memberIds: [people[0]!.memberId!],
      });
      const drawn = await createRandomTeams(kit.as(staff), { eventId: event.id, teamSize: 2 });
      expect(drawn).toHaveLength(1);
      expect(drawn[0]!.members).toHaveLength(2);
      await expect(
        createRandomTeams(kit.as(staff), { eventId: event.id, teamSize: 2 }),
      ).rejects.toThrow(/No unassigned members/);
      expect(await listTeams(kit.as(people[1]!), { eventId: event.id })).toHaveLength(2);
    });

    it('BREAK: members cannot manage teams', async () => {
      const event = await tournament();
      const member = await kit.member();
      await expect(
        createTeam(kit.as(member), {
          eventId: event.id,
          name: 'Mine',
          memberIds: [member.memberId!],
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createRandomTeams(kit.as(member), { eventId: event.id, teamSize: 2 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('brackets', () => {
    it('generates a bracket with byes for 5 teams and locks teams afterwards', async () => {
      const event = await tournament();
      const created = await teams(event.id, 5);
      const bracket = await generateBracket(kit.as(staff), { eventId: event.id });
      expect(bracket.state).toBe('in_progress');
      expect(bracket.rounds.map((r) => r.name)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
      const firstRound = matchesIn(bracket, 1);
      expect(firstRound.filter((m) => m.status === 'bye')).toHaveLength(3);
      expect(firstRound.filter((m) => m.status === 'ready')).toHaveLength(1);
      const semis = matchesIn(bracket, 2);
      expect(semis[0]!.teamA?.name).toBe('Squad 1');
      expect(semis[1]).toMatchObject({ status: 'ready' });
      expect([semis[1]!.teamA?.name, semis[1]!.teamB?.name]).toEqual(['Squad 2', 'Squad 3']);

      await expect(generateBracket(kit.as(staff), { eventId: event.id })).rejects.toBeInstanceOf(
        ConflictError,
      );
      const late = await kit.member();
      await expect(
        createTeam(kit.as(staff), { eventId: event.id, name: 'Late', memberIds: [late.memberId!] }),
      ).rejects.toThrow(/locked/);
      await expect(deleteTeam(kit.as(staff), { teamId: created[0]!.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(
        updateEvent(kit.as(staff), { eventId: event.id, kind: 'meetup' }),
      ).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('advances winners and completes the tournament and its event on the final', async () => {
      const event = await tournament();
      await teams(event.id, 4);
      let bracket = await generateBracket(kit.as(staff), { eventId: event.id });
      const [m1, m2] = matchesIn(bracket, 1);
      await expect(
        reportMatch(kit.as(staff), { matchId: matchesIn(bracket, 2)[0]!.id, scoreA: 1, scoreB: 0 }),
      ).rejects.toThrow(/waiting for its teams/);

      bracket = await reportMatch(kit.as(staff), { matchId: m1!.id, scoreA: 3, scoreB: 1 });
      expect(matchesIn(bracket, 2)[0]).toMatchObject({ status: 'pending' });
      bracket = await reportMatch(kit.as(staff), {
        matchId: m2!.id,
        scoreA: 2,
        scoreB: 2,
        winner: 'b',
      });
      const final = matchesIn(bracket, 2)[0]!;
      expect(final.status).toBe('ready');
      expect([final.teamA?.name, final.teamB?.name]).toEqual(['Squad 1', 'Squad 3']);

      await expect(
        reportMatch(kit.as(staff), { matchId: m1!.id, scoreA: 0, scoreB: 3 }),
      ).rejects.toThrow(/already has a result/);

      bracket = await reportMatch(kit.as(staff), { matchId: final.id, scoreA: 0, scoreB: 4 });
      expect(bracket.state).toBe('completed');
      expect(bracket.champion?.name).toBe('Squad 3');
      expect((await getEvent(kit.system, { eventId: event.id })).status).toBe('completed');

      const results = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'tournament.completed'));
      expect(results).toHaveLength(4);
      const placements = results.map((r) => r.payload.placement).sort();
      expect(placements).toEqual([1, 2, null, null]);
      expect(results.every((r) => r.subjectMemberId)).toBe(true);
      const matchEvents = await kit.db
        .select()
        .from(domainEvents)
        .where(eq(domainEvents.type, 'tournament.match_completed'));
      expect(matchEvents).toHaveLength(3);
      const view = await getBracket(kit.as(await kit.member()), { eventId: event.id });
      expect(view.champion?.name).toBe('Squad 3');
    });

    it('supports random seeding deterministically', async () => {
      const event = await tournament();
      await teams(event.id, 6);
      const bracket = await generateBracket(kit.as(staff), {
        eventId: event.id,
        seeding: 'random',
        seed: 'fixed',
      });
      const seeds = bracket.rounds.flatMap((r) =>
        r.matches.flatMap((m) => [m.teamA?.seed, m.teamB?.seed]),
      );
      expect(seeds.filter((s) => s !== undefined).length).toBeGreaterThan(0);
      expect(matchesIn(bracket, 1).filter((m) => m.status === 'bye')).toHaveLength(2);
    });

    it('BREAK: invalid reports, non-tournaments and unauthorized reporters are refused', async () => {
      const event = await tournament();
      await teams(event.id, 2);
      const bracket = await generateBracket(kit.as(staff), { eventId: event.id });
      const final = matchesIn(bracket, 1)[0]!;
      const member = await kit.member();
      await expect(
        reportMatch(kit.as(member), { matchId: final.id, scoreA: 1, scoreB: 0 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 1, scoreB: 1 }),
      ).rejects.toThrow(/Tied score/);
      await expect(
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 1 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: -1, scoreB: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 1e9, scoreB: 0 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 5, scoreB: 1, winner: 'b' }),
      ).rejects.toThrow(/does not match/);
      await expect(
        reportMatch(kit.as(staff), {
          matchId: '00000000-0000-4000-8000-000000000000',
          winner: 'a',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const forfeit = await reportMatch(kit.as(staff), { matchId: final.id, winner: 'a' });
      expect(forfeit.state).toBe('completed');

      const meetup = await scheduleEvent(kit.as(staff), {
        title: 'Not a cup',
        kind: 'meetup',
        startsAt: new Date(kit.clock.now().getTime() + DAY),
      });
      await teams(meetup.id, 2);
      await expect(generateBracket(kit.as(staff), { eventId: meetup.id })).rejects.toThrow(
        /tournament events/,
      );
      const lonely = await tournament();
      await teams(lonely.id, 1);
      await expect(generateBracket(kit.as(staff), { eventId: lonely.id })).rejects.toThrow(
        /between 2 and/,
      );
    });

    it('BREAK: concurrent reports of the same match record one result', async () => {
      const event = await tournament();
      await teams(event.id, 2);
      const bracket = await generateBracket(kit.as(staff), { eventId: event.id });
      const final = matchesIn(bracket, 1)[0]!;
      const outcomes = await Promise.allSettled([
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 2, scoreB: 0 }),
        reportMatch(kit.as(staff), { matchId: final.id, scoreA: 0, scoreB: 2 }),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(InvalidStateError);
      const done = await getBracket(kit.system, { eventId: event.id });
      expect(done.state).toBe('completed');
    });
  });
});
