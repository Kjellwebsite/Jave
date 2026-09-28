/**
 * TEST DATA ONLY — finished JVLN Arena games for the end-to-end database, so
 * the all-time board has history and a staff-only profile to hide.
 *
 * Games are played through core's own session services on a manual clock set
 * in the past (the stored timestamps are genuine, just earlier). The winner
 * reads the answer key from the stored engine state — something only test
 * data may do; the API never exposes it.
 */
import {
  DAY,
  games,
  ManualClock,
  resolveUserActor,
  type ServiceContext,
  updateProfile,
  withActor,
} from '@jave/core';

const ROUNDS = 5;
const SECONDS_PER_QUESTION = 10;
const OPTIONS = 4;
/** Past each reveal, plus the 2 s a player-initiated tick leaves to the worker. */
const PAST_REVEAL_MS = games.trivia.TRIVIA_REVEAL_MS + games.USER_TICK_OVERDUE_MS;
/** Seeded games happened two days ago. */
const HISTORY_OFFSET_MS = 2 * DAY;
const SEED_INSTANCE = 'dev-arena-history';

/** Winner first; the winner always answers right, everyone else always wrong. */
const SEEDED_GAMES: readonly (readonly string[])[] = [
  ['founder', 'core', 'moderator'],
  ['founder', 'core'],
  ['founder', 'moderator'],
  ['moderator', 'core'],
  ['moderator', 'core'],
  ['core', 'moderator'],
];

interface Table {
  ctx(persona: string): ServiceContext;
  answerKey(sessionId: string, round: number): Promise<number>;
}

async function playSeededGame(table: Table, clock: ManualClock, seats: readonly string[]) {
  const [winner, ...others] = seats;
  if (!winner) throw new Error('a seeded game needs a winner');
  const host = table.ctx(winner);
  const session = await games.createSession(host, {
    gameKey: games.trivia.TRIVIA_KEY,
    surface: 'activity',
    activityInstanceId: SEED_INSTANCE,
    config: { rounds: ROUNDS, secondsPerQuestion: SECONDS_PER_QUESTION },
    hostPlays: true,
  });
  for (const persona of others) {
    await games.joinSession(table.ctx(persona), { sessionId: session.id });
  }
  await games.startSession(host, { sessionId: session.id });
  for (let round = 1; round <= ROUNDS; round++) {
    const right = await table.answerKey(session.id, round);
    await games.submitMove(host, { sessionId: session.id, move: { round, choice: right } });
    for (const persona of others) {
      await games.submitMove(table.ctx(persona), {
        sessionId: session.id,
        move: { round, choice: (right + 1) % OPTIONS },
      });
    }
    clock.advance(PAST_REVEAL_MS);
    await games.tickSession(host, { sessionId: session.id });
  }
  const done = await games.getSessionView(host, { sessionId: session.id });
  if (done.status !== 'completed') throw new Error(`seeded game ended as ${done.status}`);
}

/**
 * Plays the seeded games and hides the founder's profile from non-staff, so
 * the board shows different rows to members and to staff.
 */
export async function seedArenaHistory(
  system: ServiceContext,
  users: ReadonlyMap<string, string>,
): Promise<void> {
  const clock = new ManualClock(new Date(system.clock.now().getTime() - HISTORY_OFFSET_MS));
  const past = { ...system, clock };
  const actors = new Map<string, ServiceContext>();
  for (const [key, userId] of users) {
    actors.set(key, withActor(past, await resolveUserActor(past, userId)));
  }
  const table: Table = {
    ctx(persona) {
      const ctx = actors.get(persona);
      if (!ctx) throw new Error(`unknown seed persona ${persona}`);
      return ctx;
    },
    async answerKey(sessionId, round) {
      const row = await system.db.query.gameSessions.findFirst({
        where: (sessions, { eq }) => eq(sessions.id, sessionId),
        columns: { state: true },
      });
      const state = row?.state as { rounds?: { correctIndex: number }[] } | undefined;
      const answer = state?.rounds?.[round - 1]?.correctIndex;
      if (answer === undefined) throw new Error('seeded game has no answer key');
      return answer;
    },
  };
  for (const seats of SEEDED_GAMES) await playSeededGame(table, clock, seats);

  const founder = table.ctx('founder');
  if (founder.actor.kind !== 'user' || !founder.actor.memberId) {
    throw new Error('the founder persona has no member record');
  }
  await updateProfile(founder, founder.actor.memberId, { profileVisibility: 'staff' });
}
