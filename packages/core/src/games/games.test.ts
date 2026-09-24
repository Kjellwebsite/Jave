import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, domainEvents, gameMoves, gameSessions, jobs, members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { HOUR, MINUTE } from '../kernel/clock';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../kernel/errors';
import { anonymousActor, type UserActor } from '../permissions/actor';
import { GAMES_TICK_JOB } from './constants';
import { DISCORD_GAMES_RENDER_JOB, getGameRender } from './discord-jobs';
import { getLeaderboard } from './leaderboard.service';
import { submitMove, tickSession } from './play.service';
import { registerGame } from './registry';
import {
  abandonSession,
  createSession,
  findLiveSession,
  getSessionView,
  joinSession,
  leaveSession,
  startSession,
} from './sessions.service';
import type { TriviaPublicView, TriviaState } from './trivia/trivia';
import type { GameDefinition } from './types';
import { sweepStaleSessions } from './jobs';
import { SNAPSHOT_BUILD_TIMEOUT_MS, warmUpTestDatabase } from '../calendar/test-support';
import { jobHandlers } from './index';

/** Full playthroughs drive dozens of jobs; allow for a loaded machine. */
const PLAYTHROUGH_TIMEOUT_MS = 120_000;

/** A third, test-only game: proves an engine plugs in with no platform changes. */
interface DuelState {
  players: string[];
  picks: Record<string, number>;
}
const duel: GameDefinition<Record<string, never>, DuelState, { pick: number }, DuelState> = {
  key: 'test-duel',
  name: 'Duel',
  description: 'Two players pick a number; higher wins.',
  minPlayers: 2,
  maxPlayers: 2,
  configSchema: z.object({}).strict(),
  moveSchema: z.object({ pick: z.number().int().min(1).max(3) }).strict(),
  init: (_config, players) => ({ players: [...players], picks: {} }),
  validateMove: (state, player) =>
    Object.hasOwn(state.picks, player)
      ? { ok: false, code: 'duplicate', reason: 'Already picked.' }
      : { ok: true },
  applyMove: (state, player, move) => ({
    state: { ...state, picks: { ...state.picks, [player]: move.pick } },
    round: 1,
    correct: null,
    points: move.pick,
  }),
  advance: (state) => state,
  nextDeadline: () => null,
  isFinished: (state) => state.players.every((p) => Object.hasOwn(state.picks, p)),
  scores: (state) => state.picks,
  publicView: (state, viewer) => ({
    players: state.players,
    picks: Object.fromEntries(
      Object.keys(state.picks).map((p) => [p, p === viewer ? state.picks[p]! : 0]),
    ),
  }),
};
registerGame(duel);

const CHANNEL = '123456789012345678';

describe('game sessions', () => {
  let kit: TestKit;
  let host: UserActor;
  let staff: UserActor;

  beforeAll(warmUpTestDatabase, SNAPSHOT_BUILD_TIMEOUT_MS);
  beforeEach(async () => {
    kit = await createTestKit();
    host = await kit.member({ roles: ['verified'] });
    staff = await kit.member({ roles: ['operations'] });
  });
  afterEach(async () => {
    await kit.close();
  });

  const lobby = (overrides: Partial<Parameters<typeof createSession>[1]> = {}, as = host) =>
    createSession(kit.as(as), {
      gameKey: 'trivia',
      surface: 'discord',
      discordChannelId: CHANNEL,
      config: { rounds: 5, secondsPerQuestion: 10 },
      ...overrides,
    });
  const row = async (id: string) =>
    (await kit.db.select().from(gameSessions).where(eq(gameSessions.id, id)))[0]!;
  const triviaState = async (id: string) => (await row(id)).state as unknown as TriviaState;
  const pendingTicks = () =>
    kit.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, GAMES_TICK_JOB), eq(jobs.status, 'pending')))
      .orderBy(asc(jobs.runAt));

  async function startedTrivia(players: UserActor[]) {
    const session = await lobby();
    for (const player of players) await joinSession(kit.as(player), { sessionId: session.id });
    return startSession(kit.as(host), { sessionId: session.id });
  }

  /** Run the game to the end: `choose` answers for each player (null = no answer). */
  async function playOut(
    sessionId: string,
    players: UserActor[],
    choose: (state: TriviaState, player: UserActor) => number | null,
  ) {
    for (let guard = 0; guard < 200; guard++) {
      const current = await row(sessionId);
      if (current.status !== 'active') return current;
      const state = current.state as unknown as TriviaState;
      if (state.phase === 'question' && Object.keys(state.answers[state.round - 1]!).length === 0) {
        for (const player of players) {
          const choice = choose(state, player);
          if (choice === null) continue;
          await submitMove(kit.as(player), { sessionId, move: { round: state.round, choice } });
          kit.clock.advance(200);
        }
      }
      const [next] = await pendingTicks();
      if (!next) throw new Error('no tick scheduled for an active game');
      if (next.runAt > kit.clock.now()) kit.clock.set(next.runAt);
      await kit.drain(jobHandlers);
    }
    throw new Error('game did not finish');
  }

  describe('lobbies', () => {
    it('hosts, joins and starts; timers and Discord renders are scheduled', async () => {
      const guest = await kit.member();
      const created = await lobby();
      expect(created).toMatchObject({
        status: 'lobby',
        version: 0,
        view: null,
        youArePlayer: true,
      });
      const joined = await joinSession(kit.as(guest), { sessionId: created.id });
      expect(joined.players.map((p) => p.userId)).toEqual([host.userId, guest.userId]);
      expect((await joinSession(kit.as(guest), { sessionId: created.id })).version).toBe(1);

      const started = await startSession(kit.as(host), { sessionId: created.id });
      expect(started.status).toBe('active');
      expect(started.version).toBe(2);
      const view = started.view as TriviaPublicView;
      expect(view).toMatchObject({
        phase: 'question',
        round: 1,
        totalRounds: 5,
        correctIndex: null,
      });
      const [tick] = await pendingTicks();
      expect(tick!.runAt.getTime()).toBe(kit.clock.now().getTime() + 10_000);
      const renders = await kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, DISCORD_GAMES_RENDER_JOB));
      expect(renders.map((j) => j.payload.version)).toEqual([0, 1, 2]);
      expect((await row(created.id)).playerCount).toBe(2);
      const found = await findLiveSession(kit.as(guest), { discordChannelId: CHANNEL });
      expect(found?.id).toBe(created.id);
    });

    it('BREAK: hosting requires canHostGames and valid, bounded input', async () => {
      const applicant = await kit.member({ roles: ['applicant'] });
      await expect(lobby({}, applicant)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createSession(kit.as(anonymousActor), { gameKey: 'trivia', surface: 'dashboard' }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(lobby({ gameKey: 'chess' })).rejects.toBeInstanceOf(NotFoundError);
      await expect(lobby({ discordChannelId: undefined })).rejects.toBeInstanceOf(ValidationError);
      await expect(lobby({ surface: 'activity' })).rejects.toBeInstanceOf(ValidationError);
      await expect(lobby({ config: { rounds: 99 } })).rejects.toBeInstanceOf(ValidationError);
      await expect(lobby({ config: { rounds: 5, admin: true } })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(lobby({ config: { blob: 'x'.repeat(5000) } })).rejects.toThrow(/too large/);
      await lobby();
      await expect(lobby()).rejects.toBeInstanceOf(ConflictError);
      await lobby({ surface: 'dashboard', discordChannelId: undefined });
      await lobby({ surface: 'dashboard', discordChannelId: undefined });
      await expect(lobby({ surface: 'dashboard', discordChannelId: undefined })).rejects.toThrow(
        /already host 3/,
      );
    });

    it('enforces lobby rules: capacity, leaving, and closing empty lobbies', async () => {
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      const duelLobby = await lobby({ gameKey: 'test-duel', config: {} });
      await joinSession(kit.as(a), { sessionId: duelLobby.id });
      await expect(joinSession(kit.as(b), { sessionId: duelLobby.id })).rejects.toThrow(/full/);
      await leaveSession(kit.as(a), { sessionId: duelLobby.id });
      await leaveSession(kit.as(a), { sessionId: duelLobby.id });
      const afterHostLeaves = await leaveSession(kit.as(host), { sessionId: duelLobby.id });
      expect(afterHostLeaves.status).toBe('abandoned');
      expect(afterHostLeaves.endReason).toBe('Everyone left the lobby.');
      await expect(joinSession(kit.as(b), { sessionId: duelLobby.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
    });

    it('BREAK: only the host or event staff start a game; staff overrides are audited', async () => {
      const guest = await kit.member();
      const session = await lobby({ gameKey: 'test-duel', config: {} });
      await expect(startSession(kit.as(host), { sessionId: session.id })).rejects.toThrow(
        /needs 2–2/,
      );
      await joinSession(kit.as(guest), { sessionId: session.id });
      await expect(startSession(kit.as(guest), { sessionId: session.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const started = await startSession(kit.as(staff), { sessionId: session.id });
      expect(started.status).toBe('active');
      const audit = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'game.started_by_staff'));
      expect(audit).toHaveLength(1);
      await expect(startSession(kit.as(host), { sessionId: session.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );
      await expect(leaveSession(kit.as(guest), { sessionId: session.id })).rejects.toThrow(
        /before the game starts/,
      );
    });

    it('a plugged-in game runs end to end with no platform changes', async () => {
      const guest = await kit.member();
      const session = await lobby({ gameKey: 'test-duel', config: {} });
      await joinSession(kit.as(guest), { sessionId: session.id });
      await startSession(kit.as(host), { sessionId: session.id });
      await submitMove(kit.as(host), { sessionId: session.id, move: { pick: 2 } });
      const done = await submitMove(kit.as(guest), { sessionId: session.id, move: { pick: 3 } });
      expect(done.view.status).toBe('completed');
      expect(done.view.players.find((p) => p.userId === guest.userId)).toMatchObject({
        placement: 1,
        score: 3,
      });
    });
  });

  describe('play', () => {
    it(
      'plays a full trivia game through tick jobs to placements and game.completed',
      async () => {
        const [a, b] = await Promise.all([kit.member(), kit.member()]);
        const session = await startedTrivia([a, b]);
        const final = await playOut(session.id, [host, a, b], (state, player) => {
          const correct = state.rounds[state.round - 1]!.correctIndex;
          if (player === host) return correct;
          if (player === a) return state.round % 2 === 0 ? correct : (correct + 1) % 4;
          return null;
        });
        expect(final.status).toBe('completed');
        const view = await getSessionView(kit.as(a), { sessionId: session.id });
        const byUser = new Map(view.players.map((p) => [p.userId, p]));
        expect(byUser.get(host.userId)!.placement).toBe(1);
        expect(byUser.get(a.userId)!.placement).toBe(2);
        expect(byUser.get(b.userId)).toMatchObject({ placement: 3, score: 0 });
        expect(byUser.get(host.userId)!.score).toBeGreaterThan(500);

        const completed = await kit.db
          .select()
          .from(domainEvents)
          .where(eq(domainEvents.type, 'game.completed'));
        expect(completed).toHaveLength(3);
        const hostEvent = completed.find((e) => e.subjectMemberId === host.memberId)!;
        expect(hostEvent.payload).toMatchObject({
          gameKey: 'trivia',
          placement: 1,
          ranked: true,
          won: true,
        });
        const moves = await kit.db
          .select()
          .from(gameMoves)
          .where(eq(gameMoves.sessionId, session.id));
        expect(moves).toHaveLength(10);
        expect(
          moves.filter((m) => m.userId === host.userId).every((m) => m.correct && m.points >= 100),
        ).toBe(true);
        await expect(
          submitMove(kit.as(host), { sessionId: session.id, move: { round: 5, choice: 0 } }),
        ).rejects.toThrow(/not running/);
      },
      PLAYTHROUGH_TIMEOUT_MS,
    );

    it('BREAK: non-players, late answers, duplicates and future rounds are refused', async () => {
      const [a, outsider] = await Promise.all([kit.member(), kit.member()]);
      const session = await startedTrivia([a]);
      const move = { round: 1, choice: 0 };
      await expect(
        submitMove(kit.as(outsider), { sessionId: session.id, move }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        submitMove(kit.as(a), { sessionId: session.id, move: { round: 2, choice: 0 } }),
      ).rejects.toThrow(/not open/);
      await submitMove(kit.as(a), { sessionId: session.id, move });
      await expect(
        submitMove(kit.as(a), { sessionId: session.id, move: { round: 1, choice: 1 } }),
      ).rejects.toBeInstanceOf(ConflictError);
      kit.clock.advance(10_000);
      await expect(submitMove(kit.as(host), { sessionId: session.id, move })).rejects.toThrow(
        /closed/,
      );
      await expect(
        submitMove(kit.as(anonymousActor), { sessionId: session.id, move }),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      const moves = await kit.db
        .select()
        .from(gameMoves)
        .where(eq(gameMoves.sessionId, session.id));
      expect(moves).toHaveLength(1);
    });

    it('BREAK: malformed and oversized moves are rejected before the engine sees them', async () => {
      const session = await startedTrivia([]);
      for (const move of [
        { round: 1, choice: 7 },
        { round: 1 },
        { round: '1', choice: 0 },
        { round: 1, choice: 0, points: 150 },
        'A',
        null,
        { round: 1, choice: 0, pad: 'x'.repeat(2000) },
      ]) {
        await expect(
          submitMove(kit.as(host), { sessionId: session.id, move }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
      await expect(
        submitMove(kit.as(host), { sessionId: 'not-a-uuid', move: { round: 1, choice: 0 } }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('BREAK: a stale version is rejected; a burst of answers all land (sequential invariant)', async () => {
      // PGlite serializes these calls; integrity.test.ts forces real version races.
      const [a, b] = await Promise.all([kit.member(), kit.member()]);
      const session = await startedTrivia([a, b]);
      await submitMove(kit.as(a), {
        sessionId: session.id,
        move: { round: 1, choice: 0 },
        expectedVersion: session.version,
      });
      await expect(
        submitMove(kit.as(b), {
          sessionId: session.id,
          move: { round: 1, choice: 0 },
          expectedVersion: session.version,
        }),
      ).rejects.toThrow(/moved on/);
      const results = await Promise.all([
        submitMove(kit.as(b), { sessionId: session.id, move: { round: 1, choice: 1 } }),
        submitMove(kit.as(host), { sessionId: session.id, move: { round: 1, choice: 2 } }),
      ]);
      expect(results.map((r) => r.version).sort()).toEqual([
        session.version + 2,
        session.version + 3,
      ]);
      const state = await triviaState(session.id);
      expect(Object.keys(state.answers[0]!).sort()).toEqual(
        [a.userId, b.userId, host.userId].sort(),
      );
      expect(state.phase).toBe('reveal');
    });

    it('BREAK: no answer leakage through any view while the question is open', async () => {
      const [a, spectator] = await Promise.all([kit.member(), kit.member()]);
      const session = await startedTrivia([a]);
      const state = await triviaState(session.id);
      const round = state.rounds[0]!;
      const result = await submitMove(kit.as(a), {
        sessionId: session.id,
        move: { round: 1, choice: round.correctIndex },
      });
      const views = [
        result.view,
        await getSessionView(kit.as(host), { sessionId: session.id }),
        await getSessionView(kit.as(spectator), { sessionId: session.id }),
        await getSessionView(kit.as(staff), { sessionId: session.id }),
        (await getGameRender(kit.system, session.id)).session,
      ];
      for (const view of views) {
        const json = JSON.stringify(view);
        const publicView = view.view as TriviaPublicView;
        expect(publicView.correctIndex).toBeNull();
        expect(publicView.fact).toBeNull();
        expect(publicView.scoreboard.every((e) => e.correct === null && e.score === 0)).toBe(true);
        expect(json).not.toContain(round.fact);
        expect(json).not.toContain(state.rounds[1]!.prompt);
        expect(json).not.toMatch(/"seed"|"state"|"answers"|"questionId"|"correctIndex":\d/);
        expect(json).not.toContain((await row(session.id)).seed);
      }
      expect((views[0]!.view as TriviaPublicView).you).toMatchObject({
        answered: true,
        correct: null,
        points: null,
      });
      expect((views[2]!.view as TriviaPublicView).you).toBeNull();
    });

    it('BREAK: tickSession is host/player/system only, and players cannot race the worker', async () => {
      const [a, outsider] = await Promise.all([kit.member(), kit.member()]);
      const session = await startedTrivia([a]);
      kit.clock.advance(10_000);
      await expect(tickSession(kit.as(outsider), { sessionId: session.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      // At the deadline the worker moves first; a player's tick does nothing yet.
      const early = await tickSession(kit.as(a), { sessionId: session.id });
      expect((early.view as TriviaPublicView).phase).toBe('question');
      expect(early.version).toBe(session.version);
      // The worker is 2 s late: now a player may nudge the game forward.
      kit.clock.advance(2_000);
      const ticked = await tickSession(kit.as(a), { sessionId: session.id });
      expect((ticked.view as TriviaPublicView).phase).toBe('reveal');
      const again = await tickSession(kit.system, { sessionId: session.id });
      expect(again.version).toBe(ticked.version);
    });
  });

  describe('results and upkeep', () => {
    it(
      'leaderboards count ranked sessions only and respect showOnLeaderboards',
      async () => {
        const [a, hidden] = await Promise.all([kit.member(), kit.member()]);
        await kit.db
          .update(members)
          .set({ showOnLeaderboards: false })
          .where(eq(members.id, hidden.memberId!));
        const ranked = await startedTrivia([a, hidden]);
        await playOut(ranked.id, [host, a, hidden], (state, player) => {
          const correct = state.rounds[state.round - 1]!.correctIndex;
          return player === a ? correct : player === hidden ? correct : null;
        });
        const solo = await lobby({ discordChannelId: '223456789012345678' }, staff);
        await startSession(kit.as(staff), { sessionId: solo.id });
        await playOut(solo.id, [staff], (state) => state.rounds[state.round - 1]!.correctIndex);
        const soloEvent = (
          await kit.db.select().from(domainEvents).where(eq(domainEvents.type, 'game.completed'))
        ).find((e) => e.subjectMemberId === staff.memberId)!;
        expect(soloEvent.payload).toMatchObject({ ranked: false, won: false, placement: 1 });

        const board = await getLeaderboard(kit.as(host), { gameKey: 'trivia', metric: 'wins' });
        const ids = board.entries.map((e) => e.memberId);
        expect(ids).not.toContain(hidden.memberId);
        expect(ids).not.toContain(staff.memberId);
        expect(board.entries[0]).toMatchObject({
          memberId: a.memberId,
          rank: 1,
          wins: 1,
          sessions: 1,
        });
        const byScore = await getLeaderboard(kit.as(host), {
          gameKey: 'trivia',
          metric: 'best_score',
        });
        expect(byScore.entries.find((e) => e.memberId === host.memberId)).toMatchObject({
          wins: 0,
          bestScore: 0,
        });
        await expect(getLeaderboard(kit.as(host), { gameKey: 'nope' })).rejects.toBeInstanceOf(
          NotFoundError,
        );
        await expect(
          getLeaderboard(kit.as(anonymousActor), { gameKey: 'trivia' }),
        ).rejects.toBeInstanceOf(UnauthenticatedError);
      },
      PLAYTHROUGH_TIMEOUT_MS,
    );

    it('abandon is host- or staff-only; the sweep closes idle lobbies and stalled games', async () => {
      const guest = await kit.member();
      const session = await lobby();
      await joinSession(kit.as(guest), { sessionId: session.id });
      await expect(abandonSession(kit.as(guest), { sessionId: session.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      const stopped = await abandonSession(kit.as(staff), {
        sessionId: session.id,
        reason: 'Clearing the channel.',
      });
      expect(stopped).toMatchObject({ status: 'abandoned', endReason: 'Clearing the channel.' });
      await expect(abandonSession(kit.as(host), { sessionId: session.id })).rejects.toBeInstanceOf(
        InvalidStateError,
      );

      const idle = await lobby();
      kit.clock.advance(30 * MINUTE);
      expect(await sweepStaleSessions(kit.system)).toEqual({ abandoned: 0, advanced: 0 });
      kit.clock.advance(1);
      expect(await sweepStaleSessions(kit.system)).toEqual({ abandoned: 1, advanced: 0 });
      expect((await row(idle.id)).endReason).toBe('The lobby expired.');

      const stalled = await lobby({ gameKey: 'test-duel', config: {} });
      await joinSession(kit.as(guest), { sessionId: stalled.id });
      await startSession(kit.as(host), { sessionId: stalled.id });
      kit.clock.advance(2 * HOUR + 1);
      expect(await sweepStaleSessions(kit.system)).toEqual({ abandoned: 1, advanced: 0 });
      expect((await row(stalled.id)).status).toBe('abandoned');
    });
  });
});
