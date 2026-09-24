import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import {
  createPostgresKit,
  POSTGRES_TEST_URL_VARIABLE,
  type PostgresKit,
} from '../calendar/test-postgres';
import { MAX_LIVE_SESSIONS_PER_HOST } from './constants';
import { submitMove } from './play.service';
import { createSession, getSessionView, joinSession, startSession } from './sessions.service';
import type { TriviaPublicView } from './trivia/trivia';

const postgresUrl = process.env[POSTGRES_TEST_URL_VARIABLE];
const SETUP_TIMEOUT_MS = 120_000;
const CREATE_BURST = MAX_LIVE_SESSIONS_PER_HOST * 2;

/**
 * Real interleaving on a real Postgres (opt-in, see `POSTGRES_TEST_URL_VARIABLE`):
 * each call runs its transaction on its own pooled connection at the same time.
 */
describe.skipIf(!postgresUrl)('game locks and version races on real Postgres', () => {
  let kit: PostgresKit;

  beforeAll(async () => {
    kit = await createPostgresKit(postgresUrl!);
  }, SETUP_TIMEOUT_MS);
  afterAll(async () => {
    await kit?.close();
  });

  it('concurrent creates respect the per-host cap', async () => {
    const host = await kit.member(['verified']);
    const outcomes = await Promise.allSettled(
      Array.from({ length: CREATE_BURST }, () =>
        createSession(kit.as(host), { gameKey: 'trivia', surface: 'dashboard' }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(
      MAX_LIVE_SESSIONS_PER_HOST,
    );
    for (const outcome of outcomes.filter((o) => o.status === 'rejected')) {
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }
  });

  it('concurrent answers all land through optimistic version retries', async () => {
    const host = await kit.member(['verified']);
    const players: UserActor[] = [host, await kit.member(), await kit.member()];
    const lobby = await createSession(kit.as(host), {
      gameKey: 'trivia',
      surface: 'dashboard',
      config: { rounds: 5, secondsPerQuestion: 10 },
    });
    for (const player of players.slice(1)) {
      await joinSession(kit.as(player), { sessionId: lobby.id });
    }
    const started = await startSession(kit.as(host), { sessionId: lobby.id });
    const results = await Promise.all(
      players.map((player, i) =>
        submitMove(kit.as(player), { sessionId: lobby.id, move: { round: 1, choice: i } }),
      ),
    );
    expect(results.map((r) => r.version).sort((a, b) => a - b)).toEqual([
      started.version + 1,
      started.version + 2,
      started.version + 3,
    ]);
    const view = await getSessionView(kit.as(host), { sessionId: lobby.id });
    expect((view.view as TriviaPublicView).phase).toBe('reveal');
  });
});
