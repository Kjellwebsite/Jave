import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../kernel/clock';
import { ValidationError } from '../kernel/errors';
import {
  buildSingleElimination,
  decideWinner,
  nextPowerOfTwo,
  type PlannedMatch,
  roundName,
  seedOrder,
} from './bracket';
import { formatEventTime } from './format';
import { classifyLocation } from './location';
import { drawTeams, nextTeamNames } from './team-draw';
import { checkInTiming, plannedReminders, resolveEventTimes, validateEventTimes } from './timing';

const teamsOf = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const seedOf = (team: string) => Number(team.slice(1));

/** Play the whole bracket with the better seed always winning; returns the final. */
function simulate(matches: PlannedMatch[]): PlannedMatch {
  const byRef = new Map(matches.map((m) => [`${m.round}:${m.position}`, { ...m }]));
  const rounds = Math.max(...matches.map((m) => m.round));
  for (let round = 1; round <= rounds; round++) {
    for (const match of [...byRef.values()].filter((m) => m.round === round)) {
      if (match.status !== 'bye') {
        expect(match.teamA && match.teamB).toBeTruthy();
        match.winner = seedOf(match.teamA!) < seedOf(match.teamB!) ? match.teamA : match.teamB;
      }
      if (match.next && match.status !== 'bye') {
        const next = byRef.get(`${match.next.round}:${match.next.position}`)!;
        if (match.next.slot === 'a') next.teamA = match.winner;
        else next.teamB = match.winner;
      }
    }
  }
  return [...byRef.values()].find((m) => m.round === rounds)!;
}

describe('bracket generation', () => {
  it('orders seeds so 1 and 2 are in opposite halves', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(() => seedOrder(6)).toThrow(RangeError);
  });

  it.each(Array.from({ length: 32 }, (_, i) => i + 2))(
    'builds a valid bracket for %i teams',
    (n) => {
      const teams = teamsOf(n);
      const plan = buildSingleElimination(teams);
      const size = nextPowerOfTwo(n);
      expect(plan.size).toBe(size);
      expect(plan.rounds).toBe(Math.ceil(Math.log2(n)));
      expect(plan.matches).toHaveLength(size - 1);
      expect(plan.byes).toBe(size - n);

      const firstRound = plan.matches.filter((m) => m.round === 1);
      const entrants = firstRound.flatMap((m) => [m.teamA, m.teamB]).filter(Boolean);
      expect([...entrants].sort()).toEqual([...teams].sort());

      const byes = firstRound.filter((m) => m.status === 'bye');
      expect(byes).toHaveLength(size - n);
      // Byes go to the top seeds, and a bye never meets a bye.
      expect(new Set(byes.map((m) => m.winner))).toEqual(new Set(teams.slice(0, size - n)));
      for (const bye of byes) expect(Boolean(bye.teamA) !== Boolean(bye.teamB)).toBe(true);

      // Every match but the final feeds exactly one slot of the next round.
      const final = plan.matches.filter((m) => m.next === null);
      expect(final).toHaveLength(1);
      expect(final[0]!.round).toBe(plan.rounds);
      const feeders = new Map<string, string[]>();
      for (const m of plan.matches) {
        if (!m.next) continue;
        const k = `${m.next.round}:${m.next.position}`;
        feeders.set(k, [...(feeders.get(k) ?? []), m.next.slot]);
      }
      for (const m of plan.matches.filter((x) => x.round > 1)) {
        expect(feeders.get(`${m.round}:${m.position}`)?.sort()).toEqual(['a', 'b']);
      }

      // With the better seed always winning, seeds 1 and 2 meet in the final.
      const played = simulate(plan.matches);
      expect(played.winner).toBe('t1');
      expect([played.teamA, played.teamB].sort()).toEqual(['t1', 't2']);
    },
  );

  it('advances bye winners into round 2 and marks full matches ready', () => {
    const plan = buildSingleElimination(teamsOf(5));
    const round2 = plan.matches.filter((m) => m.round === 2);
    // Seeds 1–3 have byes; round 2 already holds 2v3.
    expect(round2.map((m) => [m.teamA, m.teamB])).toEqual([
      ['t1', null],
      ['t2', 't3'],
    ]);
    expect(round2.map((m) => m.status)).toEqual(['pending', 'ready']);
  });

  it('rejects degenerate input', () => {
    expect(() => buildSingleElimination([])).toThrow(RangeError);
    expect(() => buildSingleElimination(['solo'])).toThrow(RangeError);
    expect(() => buildSingleElimination(['a', 'a'])).toThrow(RangeError);
  });

  it('names rounds from the end', () => {
    expect([1, 2, 3, 4, 5].map((r) => roundName(r, 5))).toEqual([
      'Round 1',
      'Round 2',
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
  });

  it('decides winners from scores, tiebreaks and forfeits', () => {
    expect(decideWinner({ scoreA: 3, scoreB: 1 })).toEqual({ slot: 'a' });
    expect(decideWinner({ scoreA: 0, scoreB: 2 })).toEqual({ slot: 'b' });
    expect(decideWinner({ scoreA: 2, scoreB: 2 })).toHaveProperty('error');
    expect(decideWinner({ scoreA: 2, scoreB: 2, winner: 'b' })).toEqual({ slot: 'b' });
    expect(decideWinner({ scoreA: null, scoreB: null })).toHaveProperty('error');
    expect(decideWinner({ scoreA: null, scoreB: null, winner: 'a' })).toEqual({ slot: 'a' });
    expect(decideWinner({ scoreA: 5, scoreB: 1, winner: 'b' })).toHaveProperty('error');
  });
});

describe('team draw', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `m${String(i).padStart(2, '0')}`);

  it('is deterministic and independent of input order', () => {
    const a = drawTeams(ids, 3, 'seed-1');
    const b = drawTeams([...ids].reverse(), 3, 'seed-1');
    expect(a).toEqual(b);
    expect(drawTeams(ids, 3, 'seed-2')).not.toEqual(a);
  });

  it('places everyone exactly once with balanced sizes', () => {
    const teams = drawTeams(ids, 3, 'x');
    expect(teams).toHaveLength(4);
    expect(teams.flat().sort()).toEqual([...ids].sort());
    const sizes = teams.map((t) => t.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(drawTeams([], 3, 'x')).toEqual([]);
    expect(() => drawTeams(ids, 0, 'x')).toThrow(RangeError);
  });

  it('numbers new teams around taken names', () => {
    expect(nextTeamNames('Team', 3, new Set(['Team 02']))).toEqual([
      'Team 01',
      'Team 03',
      'Team 04',
    ]);
  });
});

describe('event timing', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  const strict = { requireFutureStart: true, requireFutureRsvpClose: true };

  it('defaults the end to two hours after the start', () => {
    const times = resolveEventTimes({ startsAt: at(HOUR) });
    expect(times.endsAt.getTime() - times.startsAt.getTime()).toBe(2 * HOUR);
  });

  it('rejects incoherent times', () => {
    const check = (input: Parameters<typeof resolveEventTimes>[0]) => () =>
      validateEventTimes(resolveEventTimes(input), now, strict);
    expect(check({ startsAt: now })).toThrow(ValidationError);
    expect(check({ startsAt: at(HOUR), endsAt: at(HOUR) })).toThrow(/after the start/);
    expect(check({ startsAt: at(HOUR), endsAt: at(8 * 24 * HOUR) })).toThrow(/7 days/);
    expect(check({ startsAt: at(500 * 24 * HOUR) })).toThrow(/too far/);
    expect(check({ startsAt: at(HOUR), rsvpClosesAt: at(2 * HOUR) })).toThrow(/before the start/);
    expect(check({ startsAt: at(HOUR), rsvpClosesAt: at(-MINUTE) })).toThrow(/future/);
    expect(check({ startsAt: at(HOUR), rsvpClosesAt: at(HOUR) })).not.toThrow();
  });

  it('opens check-in 30 minutes early and closes it at the end, inclusive', () => {
    const event = { startsAt: at(HOUR), endsAt: at(3 * HOUR) };
    expect(checkInTiming(event, at(30 * MINUTE - 1))).toBe('early');
    expect(checkInTiming(event, at(30 * MINUTE))).toBe('open');
    expect(checkInTiming(event, at(3 * HOUR))).toBe('open');
    expect(checkInTiming(event, at(3 * HOUR + 1))).toBe('closed');
  });

  it('plans only reminders that are still in the future', () => {
    expect(plannedReminders(at(48 * HOUR), now).map((r) => r.key)).toEqual(['24h', '1h']);
    expect(plannedReminders(at(5 * HOUR), now).map((r) => r.key)).toEqual(['1h']);
    expect(plannedReminders(at(HOUR), now)).toEqual([]);
  });

  it('formats times deterministically in UTC', () => {
    expect(formatEventTime(new Date('2026-03-05T18:07:00.000Z'))).toBe('Thu 5 Mar 2026, 18:07 UTC');
  });
});

describe('BREAK: event locations', () => {
  it('classifies channels, http(s) URLs and place names', () => {
    expect(classifyLocation('123456789012345678')).toBe('channel');
    expect(classifyLocation('https://meet.example.com/room')).toBe('url');
    expect(classifyLocation('Lab 3, Berlin')).toBe('text');
    expect(classifyLocation('Room: 4')).toBe('text');
  });

  it('rejects script and non-http schemes', () => {
    for (const value of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>',
      'vbscript:msgbox',
      'ftp://example.com',
      'file:///etc/passwd',
      'https://',
    ]) {
      expect(classifyLocation(value), value).toBeNull();
    }
  });
});
