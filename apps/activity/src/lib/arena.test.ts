import { describe, expect, it } from 'vitest';
import type { ArenaResponse, ArenaSessionWire, TriviaViewWire } from '../api/contract';
import {
  IDLE_POLL_MS,
  LIVE_POLL_MS,
  MAX_BACKOFF_MS,
  newerResponse,
  pollDelay,
  remainingFraction,
  secondsLeft,
  shouldTick,
  stageOf,
  standings,
  TICK_AFTER_OVERDUE_MS,
} from './arena';

const OPENED = 1_000_000;
const CLOSES = OPENED + 20_000;

function trivia(overrides: Partial<TriviaViewWire> = {}): TriviaViewWire {
  return {
    phase: 'question',
    round: 1,
    totalRounds: 10,
    secondsPerQuestion: 20,
    openedAt: OPENED,
    closesAt: CLOSES,
    revealUntil: null,
    question: { prompt: 'Q', options: ['a', 'b', 'c', 'd'], category: 'logic', difficulty: 'easy' },
    correctIndex: null,
    fact: null,
    answeredCount: 0,
    playerCount: 2,
    scoreboard: [],
    you: null,
    ...overrides,
  };
}

function session(overrides: Partial<ArenaSessionWire> = {}): ArenaSessionWire {
  return {
    id: 's1',
    status: 'active',
    version: 3,
    gameName: 'Trivia',
    isHost: false,
    youArePlayer: true,
    canStart: false,
    canJoin: false,
    practice: false,
    minPlayers: 1,
    maxPlayers: 25,
    config: { rounds: 10, secondsPerQuestion: 20, difficulty: 'mixed' },
    players: [],
    trivia: trivia(),
    endReason: null,
    ...overrides,
  };
}

describe('arena timing', () => {
  it('nudges a question only once it is overdue by the server grace', () => {
    const live = session();
    expect(shouldTick(live, CLOSES)).toBe(false);
    expect(shouldTick(live, CLOSES + TICK_AFTER_OVERDUE_MS - 1)).toBe(false);
    expect(shouldTick(live, CLOSES + TICK_AFTER_OVERDUE_MS)).toBe(true);
  });

  it('nudges a reveal at its end, and never for spectators or lobbies', () => {
    const revealUntil = CLOSES + 5_000;
    const reveal = session({ trivia: trivia({ phase: 'reveal', revealUntil }) });
    expect(shouldTick(reveal, revealUntil + TICK_AFTER_OVERDUE_MS)).toBe(true);
    const spectator = session({ youArePlayer: false, isHost: false });
    expect(shouldTick(spectator, CLOSES + 60_000)).toBe(false);
    expect(shouldTick(session({ status: 'lobby', trivia: null }), CLOSES + 60_000)).toBe(false);
    expect(shouldTick(null, CLOSES)).toBe(false);
  });

  it('computes the ring and the seconds from server time', () => {
    const view = trivia();
    expect(remainingFraction(view, OPENED)).toBe(1);
    expect(remainingFraction(view, OPENED + 10_000)).toBeCloseTo(0.5);
    expect(remainingFraction(view, CLOSES + 1)).toBe(0);
    expect(secondsLeft(view, OPENED + 10_001)).toBe(10);
    expect(secondsLeft(view, CLOSES + 5)).toBe(0);
    const reveal = trivia({ phase: 'reveal', revealUntil: CLOSES + 5_000 });
    expect(remainingFraction(reveal, CLOSES + 2_500)).toBeCloseTo(0.5);
  });

  it('polls at 1 Hz while live, slower while idle, and backs off after failures', () => {
    expect(pollDelay(session(), 0)).toBe(LIVE_POLL_MS);
    expect(pollDelay(session({ status: 'lobby' }), 0)).toBe(LIVE_POLL_MS);
    expect(pollDelay(session({ status: 'completed' }), 0)).toBe(IDLE_POLL_MS);
    expect(pollDelay(null, 0)).toBe(IDLE_POLL_MS);
    expect(pollDelay(session(), 1)).toBe(LIVE_POLL_MS);
    expect(pollDelay(session(), 3)).toBe(4 * LIVE_POLL_MS);
    expect(pollDelay(session(), 20)).toBe(MAX_BACKOFF_MS);
  });
});

describe('arena state', () => {
  const response = (s: ArenaSessionWire | null, serverNow = 1): ArenaResponse => ({
    serverNow,
    session: s,
    liveSessionId: s?.id ?? null,
    canHost: true,
  });

  it('BREAK: an out-of-order older response never rolls the view back', () => {
    const current = response(session({ version: 7 }), 10);
    const stale = response(session({ version: 6, trivia: trivia({ round: 1 }) }), 11);
    const kept = newerResponse(current, stale);
    expect(kept.session!.version).toBe(7);
    expect(kept.serverNow).toBe(11);
    const next = response(session({ version: 8 }), 12);
    expect(newerResponse(current, next).session!.version).toBe(8);
    const other = response(session({ id: 's2', version: 1 }), 13);
    expect(newerResponse(current, other).session!.id).toBe('s2');
    expect(newerResponse(current, response(null)).session).toBeNull();
  });

  it('maps sessions to stages', () => {
    expect(stageOf(null)).toBe('none');
    expect(stageOf(session({ status: 'lobby', trivia: null }))).toBe('lobby');
    expect(stageOf(session())).toBe('question');
    expect(stageOf(session({ trivia: trivia({ phase: 'reveal' }) }))).toBe('reveal');
    expect(stageOf(session({ trivia: trivia({ phase: 'pending' }) }))).toBe('starting');
    expect(stageOf(session({ status: 'completed' }))).toBe('completed');
    expect(stageOf(session({ status: 'abandoned' }))).toBe('abandoned');
  });

  it('orders final standings by placement with shared places kept', () => {
    const completed = session({
      status: 'completed',
      players: [
        { key: 'p1', displayName: 'A', isYou: false, isHost: true, score: 250, placement: 2 },
        { key: 'p2', displayName: 'B', isYou: true, isHost: false, score: 400, placement: 1 },
        { key: 'p3', displayName: 'C', isYou: false, isHost: false, score: 250, placement: 2 },
        { key: 'p4', displayName: 'D', isYou: false, isHost: false, score: null, placement: null },
      ],
    });
    expect(standings(completed).map((s) => [s.key, s.placement])).toEqual([
      ['p2', 1],
      ['p1', 2],
      ['p3', 2],
    ]);
  });
});
