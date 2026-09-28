import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { games, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { gameSessions, members as membersTable } from '@jave/database';
import type { ActivityErrorBody, ArenaBoardResponse, ArenaResponse } from '../contract';
import { ACTIVITY_RATE_LIMITS } from '../limits';
import { apiRequest, INSTANCE, readJson, testDeps, tokenFor } from '../testing/support';
import { handleArenaState } from './arena';
import { handleArenaBoard } from './arena-board';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

const ROUNDS = 5;
const SECONDS = 10;
const OPTIONS = 4;
const PAST_REVEAL_MS = games.trivia.TRIVIA_REVEAL_MS + games.USER_TICK_OVERDUE_MS;

async function board(token: string | undefined): Promise<Response> {
  return handleArenaBoard(apiRequest('GET', '/trivia/leaderboard', { token }), testDeps(kit));
}

async function rows(viewer: UserActor): Promise<[string, number, number, boolean][]> {
  const response = await board(tokenFor(kit, viewer));
  expect(response.status).toBe(200);
  const body = await readJson<ArenaBoardResponse>(response);
  return body.entries.map((entry) => [entry.displayName, entry.rank, entry.wins, entry.isYou]);
}

/** TEST ONLY: the answer key is read from the stored engine state, never from the API. */
async function correctIndex(sessionId: string, round: number): Promise<number> {
  const [row] = await kit.db.select().from(gameSessions).where(eq(gameSessions.id, sessionId));
  const state = row!.state as { rounds: { correctIndex: number }[] };
  return state.rounds[round - 1]!.correctIndex;
}

/** A complete trivia game through core, in this Activity instance: the winner is always right. */
async function playGame(winner: UserActor, others: UserActor[]): Promise<string> {
  const session = await games.createSession(kit.as(winner), {
    gameKey: games.trivia.TRIVIA_KEY,
    surface: 'activity',
    activityInstanceId: INSTANCE,
    config: { rounds: ROUNDS, secondsPerQuestion: SECONDS },
    hostPlays: true,
  });
  for (const player of others) await games.joinSession(kit.as(player), { sessionId: session.id });
  await games.startSession(kit.as(winner), { sessionId: session.id });
  for (let round = 1; round <= ROUNDS; round++) {
    const right = await correctIndex(session.id, round);
    await games.submitMove(kit.as(winner), {
      sessionId: session.id,
      move: { round, choice: right },
    });
    for (const player of others) {
      await games.submitMove(kit.as(player), {
        sessionId: session.id,
        move: { round, choice: (right + 1) % OPTIONS },
      });
    }
    kit.clock.advance(PAST_REVEAL_MS);
    await games.tickSession(kit.as(winner), { sessionId: session.id });
  }
  const done = await games.getSessionView(kit.as(winner), { sessionId: session.id });
  expect(done.status).toBe('completed');
  return session.id;
}

async function hideProfile(actor: UserActor, visibility: 'staff' | 'members'): Promise<void> {
  await kit.db
    .update(membersTable)
    .set({ profileVisibility: visibility })
    .where(eq(membersTable.id, actor.memberId!));
}

describe('JVLN Arena · all-time board', () => {
  it('ranks ranked games by wins and marks the viewer; practice never counts', async () => {
    const nova = await kit.member({ roles: ['verified'], username: 'nova' });
    const orion = await kit.member({ roles: ['member'], username: 'orion' });
    const solo = await kit.member({ roles: ['member'], username: 'solo' });
    await playGame(nova, [orion]);
    await playGame(nova, [orion]);
    await playGame(solo, []);

    expect(await rows(orion)).toEqual([
      ['nova', 1, 2, false],
      ['orion', 2, 0, true],
    ]);
    const response = await board(tokenFor(kit, nova));
    const body = await readJson<ArenaBoardResponse>(response);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.gameName).toBe('Trivia');
    expect(body.entries[0]).toEqual({
      rank: 1,
      displayName: 'nova',
      isYou: true,
      wins: 2,
      bestScore: expect.any(Number),
      sessions: 2,
    });
  });

  it('BREAK: never lists a profile the viewer could not open, and leaves no gap', async () => {
    const nova = await kit.member({ roles: ['verified'], username: 'nova' });
    const hidden = await kit.member({ roles: ['member'], username: 'hidden' });
    const guest = await kit.member({ roles: ['member'], username: 'guest' });
    await playGame(hidden, [nova, guest]);
    await hideProfile(hidden, 'staff');

    // Members never see the staff-only profile; the ranks close up behind it.
    const seenByGuest = await rows(guest);
    expect(seenByGuest.map(([name]) => name)).not.toContain('hidden');
    expect(seenByGuest.map(([, rank]) => rank)).toEqual([1, 1]);
    // Staff see every profile on their own screen, as on the dashboard.
    const staff = await kit.member({ roles: ['operations'] });
    expect((await rows(staff))[0]).toEqual(['hidden', 1, 1, false]);
    // The hidden player still sees their own row.
    expect(await rows(hidden)).toContainEqual(['hidden', 1, 1, true]);
  });

  it('a staff-only player stays on the table they played at, never on a member’s board', async () => {
    const hidden = await kit.member({ roles: ['member'], username: 'hidden' });
    const guest = await kit.member({ roles: ['member'], username: 'guest' });
    await hideProfile(hidden, 'staff');
    const sessionId = await playGame(hidden, [guest]);

    // The session standings are the shared table (as on the bot's live panel):
    // co-players see who they played, by seat and display name only.
    const table = await handleArenaState(
      apiRequest('GET', `/trivia/session?sessionId=${sessionId}`, {
        token: tokenFor(kit, guest),
      }),
      testDeps(kit),
    );
    expect(table.status).toBe(200);
    const finished = (await readJson<ArenaResponse>(table)).session!;
    expect(finished.players.map((player) => [player.displayName, player.placement])).toEqual([
      ['hidden', 1],
      ['guest', 2],
    ]);
    // The all-time board applies profile visibility: the guest's board omits the winner.
    expect(await rows(guest)).toEqual([['guest', 1, 0, true]]);
  });

  it('BREAK: members who opted out of leaderboards are not listed', async () => {
    const nova = await kit.member({ roles: ['verified'], username: 'nova' });
    const quiet = await kit.member({ roles: ['member'], username: 'quiet' });
    await playGame(quiet, [nova]);
    await kit.db
      .update(membersTable)
      .set({ showOnLeaderboards: false })
      .where(eq(membersTable.id, quiet.memberId!));
    expect(await rows(nova)).toEqual([['nova', 1, 0, true]]);
  });

  it('BREAK: the board carries no account ids, handles or Discord ids', async () => {
    const nova = await kit.member({ roles: ['verified'], username: 'nova' });
    const orion = await kit.member({ roles: ['member'], username: 'orion_x' });
    await playGame(nova, [orion]);
    const raw = await (await board(tokenFor(kit, nova))).text();
    for (const secret of [
      nova.userId,
      orion.userId,
      nova.memberId!,
      orion.memberId!,
      orion.discordId,
      '"handle"',
      '"memberId"',
    ]) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it('BREAK: refuses missing tokens and throttles beyond the budget', async () => {
    const unauthenticated = await board(undefined);
    expect(unauthenticated.status).toBe(401);
    expect((await readJson<ActivityErrorBody>(unauthenticated)).error.code).toBe('UNAUTHENTICATED');
    const member = await kit.member({ roles: ['member'] });
    const token = tokenFor(kit, member);
    let last: Response | null = null;
    for (let i = 0; i <= ACTIVITY_RATE_LIMITS.board.limit; i++) last = await board(token);
    expect(last!.status).toBe(429);
    expect(last!.headers.get('retry-after')).toBeTruthy();
  });
});
