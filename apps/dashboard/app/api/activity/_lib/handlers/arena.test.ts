import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { games, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { auditLogs, gameSessions, members as membersTable } from '@jave/database';
import type { ActivityErrorBody, ArenaResponse, ArenaSessionWire } from '../contract';
import { ACTIVITY_RATE_LIMITS } from '../limits';
import {
  apiRequest,
  INSTANCE,
  OTHER_INSTANCE,
  readJson,
  testDeps,
  tokenFor,
} from '../testing/support';
import {
  handleArenaClose,
  handleArenaLeave,
  handleArenaMove,
  handleArenaOpen,
  handleArenaStart,
  handleArenaState,
  handleArenaTick,
} from './arena';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

const ROUNDS = 5;
const SECONDS = 10;
/** Past a reveal, plus the 2 s a player-initiated tick must wait for the worker. */
const PAST_REVEAL_MS = games.trivia.TRIVIA_REVEAL_MS + games.USER_TICK_OVERDUE_MS;

type Handler = typeof handleArenaOpen;

async function call(
  handler: Handler,
  method: 'GET' | 'POST',
  path: string,
  token: string,
  body?: unknown,
) {
  return handler(apiRequest(method, path, { token, body }), testDeps(kit));
}

async function ok(response: Response): Promise<ArenaResponse> {
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return readJson<ArenaResponse>(response);
}

async function status(response: Response): Promise<[number, string]> {
  return [response.status, (await readJson<ActivityErrorBody>(response)).error.code];
}

const open = (token: string, body: unknown = {}) =>
  call(handleArenaOpen, 'POST', '/trivia/session', token, body);
const state = (token: string, sessionId?: string) =>
  call(
    handleArenaState,
    'GET',
    sessionId ? `/trivia/session?sessionId=${sessionId}` : '/trivia/session',
    token,
  );
const start = (token: string, sessionId: string) =>
  call(handleArenaStart, 'POST', '/trivia/start', token, { sessionId });
const tick = (token: string, sessionId: string) =>
  call(handleArenaTick, 'POST', '/trivia/tick', token, { sessionId });
const leave = (token: string, sessionId: string) =>
  call(handleArenaLeave, 'POST', '/trivia/leave', token, { sessionId });
const close = (token: string, sessionId: string) =>
  call(handleArenaClose, 'POST', '/trivia/close', token, { sessionId });
const move = (token: string, sessionId: string, round: number, choice: number) =>
  call(handleArenaMove, 'POST', '/trivia/move', token, { sessionId, round, choice });

interface Table {
  host: UserActor;
  guest: UserActor;
  hostToken: string;
  guestToken: string;
  session: ArenaSessionWire;
}

async function lobbyForTwo(): Promise<Table> {
  const host = await kit.member({ roles: ['verified'], username: 'hostess' });
  const guest = await kit.member({ roles: ['member'], username: 'visitor' });
  const hostToken = tokenFor(kit, host);
  const guestToken = tokenFor(kit, guest);
  const opened = await ok(
    await open(hostToken, { config: { rounds: ROUNDS, secondsPerQuestion: SECONDS } }),
  );
  const joined = await ok(await open(guestToken));
  expect(joined.session!.id).toBe(opened.session!.id);
  return { host, guest, hostToken, guestToken, session: joined.session! };
}

describe('JVLN Arena · trivia', () => {
  it('opens a lobby for the instance, then joins it for the next player', async () => {
    const { session, hostToken } = await lobbyForTwo();
    expect(session).toMatchObject({
      status: 'lobby',
      isHost: false,
      youArePlayer: true,
      canStart: false,
      canJoin: false,
      practice: false,
      config: { rounds: ROUNDS, secondsPerQuestion: SECONDS, difficulty: 'mixed' },
    });
    expect(session.players.map((p) => [p.key, p.displayName, p.isHost, p.isYou])).toEqual([
      ['p1', 'hostess', true, false],
      ['p2', 'visitor', false, true],
    ]);
    expect(session.canClose).toBe(false);
    const hostView = await ok(await state(hostToken));
    expect(hostView.session).toMatchObject({ isHost: true, canStart: true, canClose: true });
    expect(hostView.liveSessionId).toBe(session.id);
    const [row] = await kit.db.select().from(gameSessions).where(eq(gameSessions.id, session.id));
    expect(row).toMatchObject({ surface: 'activity', activityInstanceId: INSTANCE });
  });

  it('plays a full two-player game to completion with correct reveals and placements', async () => {
    const { hostToken, guestToken, session } = await lobbyForTwo();
    const started = await ok(await start(hostToken, session.id));
    expect(started.session!.status).toBe('active');

    let hostCorrect = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      const view = (await ok(await state(guestToken, session.id))).session!.trivia!;
      expect(view).toMatchObject({ phase: 'question', round, totalRounds: ROUNDS });
      expect(view.question!.options).toHaveLength(4);
      // Anti-cheat: nothing about the answer before the round closes.
      expect(view.correctIndex).toBeNull();
      expect(view.fact).toBeNull();

      const afterHost = (await ok(await move(hostToken, session.id, round, 0))).session!.trivia!;
      expect(afterHost.you).toMatchObject({ answered: true, choice: 0, correct: null });
      expect(afterHost.answeredCount).toBe(1);
      // The other player sees that someone answered, never what.
      const guestSees = (await ok(await state(guestToken, session.id))).session!.trivia!;
      expect(guestSees.scoreboard.find((s) => !s.isYou)).toMatchObject({
        answered: true,
        correct: null,
      });
      expect(JSON.stringify(guestSees)).not.toContain('"choice":0');

      const reveal = (await ok(await move(guestToken, session.id, round, 1))).session!.trivia!;
      expect(reveal.phase).toBe('reveal');
      expect(reveal.correctIndex).not.toBeNull();
      expect(reveal.fact).toBeTruthy();
      if (reveal.correctIndex === 0) hostCorrect++;

      kit.clock.advance(PAST_REVEAL_MS);
      await ok(await tick(guestToken, session.id));
    }

    const final = (await ok(await state(hostToken, session.id))).session!;
    expect(final.status).toBe('completed');
    expect(final.practice).toBe(false);
    expect(final.players.every((p) => p.placement !== null && p.score !== null)).toBe(true);
    const host = final.players.find((p) => p.isYou)!;
    if (hostCorrect > 0) expect(host.score).toBeGreaterThan(0);
    expect(final.trivia!.phase).toBe('finished');
    // Nothing is live after the game ends.
    expect((await ok(await state(hostToken))).session).toBeNull();
  });

  it('keeps the round open until the deadline; only overdue ticks advance it', async () => {
    const { hostToken, guestToken, session } = await lobbyForTwo();
    await ok(await start(hostToken, session.id));
    await ok(await move(hostToken, session.id, 1, 2));
    kit.clock.advance(SECONDS * 1000);
    // Deadline just passed: a player tick must leave it to the worker for 2 s.
    const early = (await ok(await tick(guestToken, session.id))).session!.trivia!;
    expect(early.phase).toBe('question');
    kit.clock.advance(games.USER_TICK_OVERDUE_MS);
    const closed = (await ok(await tick(guestToken, session.id))).session!.trivia!;
    expect(closed.phase).toBe('reveal');
    // A late answer is refused by server time, whatever the client shows.
    expect(await status(await move(guestToken, session.id, 1, 1))).toEqual([409, 'INVALID_STATE']);
  });

  it('players opening at the same instant end up in one lobby', async () => {
    const players = await Promise.all([1, 2, 3].map(() => kit.member({ roles: ['member'] })));
    const results = await Promise.all(players.map((player) => open(tokenFor(kit, player))));
    const sessions = await Promise.all(results.map(ok));
    expect(new Set(sessions.map((r) => r.session!.id)).size).toBe(1);
    const final = (await ok(await state(tokenFor(kit, players[0]!)))).session!;
    expect(final.players).toHaveLength(3);
  });

  it('a single player plays practice', async () => {
    const solo = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, solo);
    const lobby = (await ok(await open(token))).session!;
    expect(lobby).toMatchObject({ practice: true, canStart: true });
  });

  it('leaving the lobby as the last player closes it', async () => {
    const solo = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, solo);
    const lobby = (await ok(await open(token))).session!;
    const left = (await ok(await leave(token, lobby.id))).session!;
    expect(left.status).toBe('abandoned');
    expect((await ok(await state(token))).session).toBeNull();
  });

  it('the host closes the lobby and frees the instance for a new one', async () => {
    const { hostToken, guestToken, session } = await lobbyForTwo();
    const closed = (await ok(await close(hostToken, session.id))).session!;
    expect(closed).toMatchObject({ status: 'abandoned', endReason: 'Stopped by the host.' });
    expect(closed).toMatchObject({ canStart: false, canClose: false, canJoin: false });
    const guestSees = await ok(await state(guestToken, session.id));
    expect(guestSees.session!.status).toBe('abandoned');
    expect(guestSees.liveSessionId).toBeNull();
    const reopened = (await ok(await open(hostToken))).session!;
    expect(reopened.id).not.toBe(session.id);
    expect(reopened.status).toBe('lobby');
  });

  it('event staff can start or close a lobby they do not host (audited by core)', async () => {
    const { session, guestToken } = await lobbyForTwo();
    const staff = await kit.member({ roles: ['operations'] });
    const staffToken = tokenFor(kit, staff);
    const seen = (await ok(await state(staffToken, session.id))).session!;
    expect(seen).toMatchObject({ isHost: false, youArePlayer: false, canStart: true });
    expect(seen.canClose).toBe(true);
    const started = (await ok(await start(staffToken, session.id))).session!;
    expect(started.status).toBe('active');
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'game.started_by_staff'));
    expect(audits).toHaveLength(1);
    // Players never see staff controls.
    expect((await ok(await state(guestToken, session.id))).session!.canClose).toBe(false);
  });

  it('BREAK: a guest cannot close the host’s lobby', async () => {
    const { guestToken, hostToken, session } = await lobbyForTwo();
    expect(await status(await close(guestToken, session.id))).toEqual([403, 'FORBIDDEN']);
    expect((await ok(await state(hostToken, session.id))).session!.status).toBe('lobby');
    const elsewhere = tokenFor(kit, await kit.member({ roles: ['operations'] }), {
      instanceId: OTHER_INSTANCE,
    });
    // Even staff act only inside their own Activity instance.
    expect(await status(await close(elsewhere, session.id))).toEqual([404, 'NOT_FOUND']);
  });

  it('BREAK: a guest cannot start the host’s lobby', async () => {
    const { guestToken, session } = await lobbyForTwo();
    expect(await status(await start(guestToken, session.id))).toEqual([403, 'FORBIDDEN']);
  });

  it('BREAK: duplicate answers, wrong rounds, bad choices and spectator moves are refused', async () => {
    const { hostToken, session } = await lobbyForTwo();
    const spectator = await kit.member({ roles: ['member'] });
    const spectatorToken = tokenFor(kit, spectator);
    await ok(await start(hostToken, session.id));
    await ok(await move(hostToken, session.id, 1, 0));
    expect(await status(await move(hostToken, session.id, 1, 1))).toEqual([409, 'CONFLICT']);
    expect(await status(await move(hostToken, session.id, 2, 1))).toEqual([409, 'INVALID_STATE']);
    expect((await move(hostToken, session.id, 1, 4)).status).toBe(400);
    expect((await move(hostToken, session.id, 1, -1)).status).toBe(400);
    expect(await status(await move(spectatorToken, session.id, 1, 0))).toEqual([403, 'FORBIDDEN']);
    // A spectator opening the Activity mid-game sees the game, not a seat.
    const watching = (await ok(await open(spectatorToken))).session!;
    expect(watching).toMatchObject({ youArePlayer: false, canJoin: false, status: 'active' });
    expect(watching.trivia!.you).toBeNull();
  });

  it('BREAK: a token only reaches sessions of its own Activity instance', async () => {
    const { hostToken, session, host } = await lobbyForTwo();
    const elsewhere = tokenFor(kit, host, { instanceId: OTHER_INSTANCE });
    expect(await status(await state(elsewhere, session.id))).toEqual([404, 'NOT_FOUND']);
    expect(await status(await start(elsewhere, session.id))).toEqual([404, 'NOT_FOUND']);
    expect(await status(await move(elsewhere, session.id, 1, 0))).toEqual([404, 'NOT_FOUND']);
    expect((await ok(await state(elsewhere))).session).toBeNull();

    // A Discord-channel session is never reachable through the Activity API.
    const discordGame = await games.createSession(kit.as(host), {
      gameKey: 'trivia',
      surface: 'discord',
      discordChannelId: '900000000000000001',
    });
    expect(await status(await state(hostToken, discordGame.id))).toEqual([404, 'NOT_FOUND']);
    expect(await status(await tick(hostToken, discordGame.id))).toEqual([404, 'NOT_FOUND']);
    // Forged and malformed ids.
    expect(await status(await state(hostToken, crypto.randomUUID()))).toEqual([404, 'NOT_FOUND']);
    expect((await state(hostToken, "1' or '1'='1")).status).toBe(400);
  });

  it('BREAK: members without hosting rights cannot open a lobby, but can join one', async () => {
    const outsider = await kit.member({ inGuild: false });
    const outsiderToken = tokenFor(kit, outsider);
    const nothing = await ok(await state(outsiderToken));
    expect(nothing.canHost).toBe(false);
    expect(await status(await open(outsiderToken))).toEqual([403, 'FORBIDDEN']);

    const host = await kit.member({ roles: ['member'] });
    await ok(await open(tokenFor(kit, host)));
    const joined = (await ok(await open(outsiderToken))).session!;
    expect(joined.youArePlayer).toBe(true);
  });

  it('BREAK: a restricted member can watch but not play', async () => {
    const host = await kit.member({ roles: ['member'] });
    const lobby = (await ok(await open(tokenFor(kit, host)))).session!;
    const restricted = await kit.member({ roles: ['member'] });
    await kit.db
      .update(membersTable)
      .set({ standing: 'restricted' })
      .where(eq(membersTable.id, restricted.memberId!));
    const token = tokenFor(kit, restricted);
    expect((await ok(await state(token, lobby.id))).canHost).toBe(false);
    expect(await status(await open(token))).toEqual([403, 'FORBIDDEN']);
  });

  it('BREAK: invalid configs and bodies are refused', async () => {
    const member = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, member);
    expect((await open(token, { config: { rounds: 500 } })).status).toBe(400);
    expect((await open(token, { config: { secondsPerQuestion: 1 } })).status).toBe(400);
    expect((await open(token, { config: { difficulty: 'impossible' } })).status).toBe(400);
    expect((await open(token, { config: { rounds: 5, seed: 'rigged' } })).status).toBe(400);
    expect((await open(token, { hostUserId: member.userId })).status).toBe(400);
    expect((await move(token, 'not-a-uuid', 1, 0)).status).toBe(400);
    expect((await state(token)).status).toBe(200);
  });

  it('BREAK: polling beyond the budget is throttled with Retry-After', async () => {
    const member = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, member);
    let last: Response | null = null;
    for (let i = 0; i <= ACTIVITY_RATE_LIMITS.poll.limit; i++) last = await state(token);
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });

  it('BREAK: the public view never carries account ids, the seed or the raw state', async () => {
    const { hostToken, guestToken, session, host, guest } = await lobbyForTwo();
    await ok(await start(hostToken, session.id));
    const raw = await (await state(guestToken, session.id)).text();
    const [row] = await kit.db.select().from(gameSessions).where(eq(gameSessions.id, session.id));
    for (const secret of [
      host.userId,
      guest.userId,
      host.discordId,
      row!.seed,
      'correctIndex":0',
      '"answers"',
    ]) {
      expect(raw, secret).not.toContain(secret);
    }
  });
});
