import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs, type Database, domainEvents, gameSessions, jobs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, ForbiddenError, ValidationError } from '../kernel/errors';
import { silentLogger } from '../kernel/logger';
import { type UserActor } from '../permissions/actor';
import { backoffMs } from '../jobs/queue';
import { Worker } from '../jobs/worker';
import {
  recordingContext,
  SNAPSHOT_BUILD_TIMEOUT_MS,
  statementIndex,
  warmUpTestDatabase,
} from '../calendar/test-support';
import { GAMES_TICK_JOB, MAX_CAS_ATTEMPTS, MAX_LIVE_SESSIONS_PER_HOST } from './constants';
import {
  DISCORD_GAMES_RENDER_JOB,
  getGameRender,
  markGameChannelUnavailable,
  markGameMessagePosted,
} from './discord-jobs';
import { getLeaderboard } from './leaderboard.service';
import { submitMove } from './play.service';
import { registerGame } from './registry';
import { createSession, joinSession, startSession } from './sessions.service';
import type { TriviaState } from './trivia/trivia';
import type { GameDefinition } from './types';
import { jobHandlers } from './index';

/** A test-only game: every player plays a number 0–3 once; the number is the score. */
interface TallyState {
  players: string[];
  plays: Record<string, number>;
}
const tally: GameDefinition<Record<string, never>, TallyState, { points: number }, TallyState> = {
  key: 'test-tally',
  name: 'Tally',
  description: 'Each player plays 0–3 points once.',
  minPlayers: 2,
  maxPlayers: 4,
  configSchema: z.object({}).strict(),
  moveSchema: z.object({ points: z.number().int().min(0).max(3) }).strict(),
  init: (_config, players) => ({ players: [...players], plays: {} }),
  validateMove: (state, player) =>
    Object.hasOwn(state.plays, player)
      ? { ok: false, code: 'duplicate', reason: 'Already played.' }
      : { ok: true },
  applyMove: (state, player, move) => ({
    state: { ...state, plays: { ...state.plays, [player]: move.points } },
    round: 1,
    correct: null,
    points: move.points,
  }),
  advance: (state) => state,
  nextDeadline: () => null,
  isFinished: (state) => state.players.every((p) => Object.hasOwn(state.plays, p)),
  scores: (state) => state.plays,
  publicView: (state) => ({ players: state.players, plays: {} }),
};
registerGame(tally);

const CHANNEL = '123456789012345678';
const MESSAGE_A = '923456789012345671';
const MESSAGE_B = '923456789012345672';
const MESSAGE_C = '923456789012345673';

/**
 * A context whose every transaction first loses a version race: another
 * writer bumps the session's version right before it (the first `races`
 * transactions only). Real SQL, real compare-and-set — only the timing of
 * the competing writer is staged, since PGlite never interleaves transactions.
 */
function racingContext(
  ctx: ServiceContext,
  sessionId: string,
  races: number,
): { ctx: ServiceContext; raced: () => number } {
  let raced = 0;
  const loseRace = async () => {
    if (raced >= races) return;
    raced++;
    await ctx.db
      .update(gameSessions)
      .set({ version: sql`${gameSessions.version} + 1` })
      .where(eq(gameSessions.id, sessionId));
  };
  const db = new Proxy(ctx.db, {
    get(target, property) {
      if (property === 'transaction') {
        return async (...args: Parameters<Database['transaction']>) => {
          await loseRace();
          return target.transaction(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as CallableFunction).bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db }, raced: () => raced };
}

/** Discord render callbacks, win rules, version races and row locks. */
describe('game session integrity', () => {
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
  const renderJobs = () =>
    kit.db.select().from(jobs).where(eq(jobs.type, DISCORD_GAMES_RENDER_JOB));

  describe('Discord render callbacks', () => {
    it('BREAK: callbacks are system-only and bound to the session channel', async () => {
      const session = await lobby();
      const render = await getGameRender(kit.system, session.id);
      expect(render).toMatchObject({ discordChannelId: CHANNEL, discordMessageId: null });
      expect(render.playerDiscordIds[host.userId]).toBe(host.discordId);
      await expect(getGameRender(kit.as(staff), session.id)).rejects.toBeInstanceOf(ForbiddenError);
      const post = { sessionId: session.id, channelId: CHANNEL, messageId: MESSAGE_A };
      await expect(
        markGameMessagePosted(kit.as(host), { ...post, replacesMessageId: null }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        markGameMessagePosted(kit.system, {
          ...post,
          channelId: '999999999999999999',
          replacesMessageId: null,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        markGameMessagePosted(kit.system, post as Parameters<typeof markGameMessagePosted>[1]),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((await getGameRender(kit.system, session.id)).discordMessageId).toBeNull();

      const dashboard = await lobby({ surface: 'dashboard', discordChannelId: undefined });
      expect((await renderJobs()).every((j) => j.payload.sessionId !== dashboard.id)).toBe(true);
    });

    it('BREAK: racing renders keep one panel; the loser deletes its duplicate', async () => {
      const session = await lobby();
      const post = (messageId: string, replacesMessageId: string | null) =>
        markGameMessagePosted(kit.system, {
          sessionId: session.id,
          channelId: CHANNEL,
          messageId,
          replacesMessageId,
        });
      // Two render runs both saw no message and both posted a lobby panel.
      expect(await post(MESSAGE_A, null)).toEqual({ messageId: MESSAGE_A, discard: null });
      expect(await post(MESSAGE_B, null)).toEqual({ messageId: MESSAGE_A, discard: MESSAGE_B });
      // A retried callback for the stored message is a no-op.
      expect(await post(MESSAGE_A, null)).toEqual({ messageId: MESSAGE_A, discard: null });
      // Re-posted after the panel was deleted on Discord.
      expect(await post(MESSAGE_C, MESSAGE_A)).toEqual({ messageId: MESSAGE_C, discard: null });
      // A slower run that also saw MESSAGE_A must not overwrite the re-post.
      expect(await post(MESSAGE_B, MESSAGE_A)).toEqual({
        messageId: MESSAGE_C,
        discard: MESSAGE_B,
      });
      expect((await row(session.id)).discordMessageId).toBe(MESSAGE_C);
    });

    it('BREAK: a channel the host cannot use ends the session, audited, without another render', async () => {
      const session = await lobby({ discordChannelId: '323456789012345678' });
      const rendersBefore = (await renderJobs()).length;
      await expect(
        markGameChannelUnavailable(kit.as(staff), {
          sessionId: session.id,
          reason: 'host_cannot_post',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const result = await markGameChannelUnavailable(kit.system, {
        sessionId: session.id,
        reason: 'host_cannot_post',
      });
      expect(result.status).toBe('abandoned');
      expect((await row(session.id)).endReason).toBe('The host cannot post in that channel.');
      expect(await renderJobs()).toHaveLength(rendersBefore);
      await expect(
        markGameChannelUnavailable(kit.system, {
          sessionId: session.id,
          reason: 'bot_cannot_post',
        }),
      ).resolves.toEqual({ status: 'abandoned' });

      const audits = await kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'game.channel_rejected'));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        result: 'denied',
        targetType: 'game_session',
        targetId: session.id,
      });
      expect(audits[0]!.context).toMatchObject({
        hostUserId: host.userId,
        channelId: '323456789012345678',
        reason: 'host_cannot_post',
        previousStatus: 'lobby',
      });
    });
  });

  describe('results', () => {
    async function playTally(points: Record<string, number>, players: UserActor[]) {
      const session = await lobby({
        gameKey: 'test-tally',
        config: {},
        surface: 'dashboard',
        discordChannelId: undefined,
      });
      for (const player of players.slice(1)) {
        await joinSession(kit.as(player), { sessionId: session.id });
      }
      await startSession(kit.as(host), { sessionId: session.id });
      for (const player of players) {
        await submitMove(kit.as(player), {
          sessionId: session.id,
          move: { points: points[player.userId]! },
        });
      }
      return kit.db
        .select()
        .from(domainEvents)
        .where(
          and(eq(domainEvents.type, 'game.completed'), eq(domainEvents.aggregateId, session.id)),
        );
    }

    it('BREAK: nobody wins a scoreless game; tied leaders with points share the win', async () => {
      const guest = await kit.member();
      const scoreless = await playTally({ [host.userId]: 0, [guest.userId]: 0 }, [host, guest]);
      expect(scoreless.map((e) => e.payload)).toEqual([
        expect.objectContaining({ placement: 1, score: 0, ranked: true, won: false }),
        expect.objectContaining({ placement: 1, score: 0, ranked: true, won: false }),
      ]);
      let board = await getLeaderboard(kit.as(host), { gameKey: 'test-tally', metric: 'wins' });
      expect(board.entries.map((e) => e.wins)).toEqual([0, 0]);

      const shared = await playTally({ [host.userId]: 2, [guest.userId]: 2 }, [host, guest]);
      expect(shared.every((e) => e.payload.won === true)).toBe(true);
      const decided = await playTally({ [host.userId]: 3, [guest.userId]: 1 }, [host, guest]);
      expect(decided.find((e) => e.subjectMemberId === guest.memberId)!.payload).toMatchObject({
        placement: 2,
        won: false,
      });
      board = await getLeaderboard(kit.as(host), { gameKey: 'test-tally', metric: 'wins' });
      expect(board.entries.map((e) => [e.memberId, e.wins, e.sessions])).toEqual([
        [host.memberId, 2, 3],
        [guest.memberId, 1, 3],
      ]);
    });
  });

  describe('version races', () => {
    async function startedTrivia() {
      const guest = await kit.member();
      const session = await lobby();
      await joinSession(kit.as(guest), { sessionId: session.id });
      const started = await startSession(kit.as(host), { sessionId: session.id });
      return { guest, session: started };
    }

    it('BREAK: a move that loses a version race retries on fresh state; a pinned version does not', async () => {
      const { guest, session } = await startedTrivia();
      const pinned = racingContext(kit.as(guest), session.id, 1);
      await expect(
        submitMove(pinned.ctx, {
          sessionId: session.id,
          move: { round: 1, choice: 0 },
          expectedVersion: session.version,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(pinned.raced()).toBe(1);

      const retrying = racingContext(kit.as(guest), session.id, 1);
      const landed = await submitMove(retrying.ctx, {
        sessionId: session.id,
        move: { round: 1, choice: 0 },
      });
      expect(retrying.raced()).toBe(1);
      expect(landed.version).toBe(session.version + 3);
      const state = (await row(session.id)).state as unknown as TriviaState;
      expect(Object.keys(state.answers[0]!)).toEqual([guest.userId]);
    });

    it('BREAK: a tick that keeps losing the version race retries instead of completing', async () => {
      const { session } = await startedTrivia();
      const [tick] = await kit.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.type, GAMES_TICK_JOB), eq(jobs.status, 'pending')));
      kit.clock.set(tick!.runAt);
      const racing = racingContext(kit.system, session.id, Number.POSITIVE_INFINITY);
      const worker = new Worker({
        db: kit.db,
        handlers: jobHandlers,
        logger: silentLogger,
        clock: kit.clock,
        contextFor: () => racing.ctx,
      });
      const outcomes = await worker.tick();
      expect(outcomes).toEqual([expect.objectContaining({ id: tick!.id, status: 'retry' })]);
      expect(racing.raced()).toBe(MAX_CAS_ATTEMPTS);
      expect(((await row(session.id)).state as unknown as TriviaState).phase).toBe('question');

      // The same job comes back after its backoff and closes the round.
      kit.clock.advance(backoffMs(1));
      const retried = await kit.drain(jobHandlers);
      expect(retried.find((o) => o.id === tick!.id)?.status).toBe('completed');
      expect((await row(session.id)).state).toMatchObject({ phase: 'reveal', round: 1 });
    });
  });

  describe('locks', () => {
    it('BREAK: a burst of creates respects the per-host cap (sequential invariant)', async () => {
      // PGlite serializes these transactions; the lock itself is covered below.
      const results = await Promise.allSettled(
        Array.from({ length: MAX_LIVE_SESSIONS_PER_HOST + 1 }, () =>
          lobby({ surface: 'dashboard', discordChannelId: undefined }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
        MAX_LIVE_SESSIONS_PER_HOST,
      );
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictError);
    });

    it('BREAK: creating a session locks the host row before counting live sessions', async () => {
      const { ctx, statements } = recordingContext(kit, host);
      await createSession(ctx, { gameKey: 'trivia', surface: 'dashboard' });
      const lock = statementIndex(statements, /from "users" where .* for update/);
      const count = statementIndex(statements, /count\(\*\).* from "game_sessions"/);
      expect(lock).toBeGreaterThanOrEqual(0);
      expect(count).toBeGreaterThan(lock);
    });
  });
});
