import { describe, expect, it } from 'vitest';
import { createRng, seededShuffle } from './rng';
import { rankPlacements } from './placements';
import { findGame, listGames, registerGame } from './registry';
import { TRIVIA_CATEGORIES, TRIVIA_QUESTIONS } from './trivia/bank';
import {
  trivia,
  TRIVIA_REVEAL_MS,
  triviaConfigSchema,
  triviaPoints,
  type TriviaState,
} from './trivia/trivia';
import { reaction, reactionConfigSchema, type ReactionState } from './reaction/reaction';

const PLAYERS = ['p-alpha', 'p-beta', 'p-gamma'];
const T0 = 1_780_000_000_000;
/** Simulates the jsonb round trip every persisted state goes through. */
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function startTrivia(seed = 'seed-1', config: Record<string, unknown> = {}): TriviaState {
  const parsed = triviaConfigSchema.parse({ rounds: 5, secondsPerQuestion: 10, ...config });
  return roundTrip(trivia.advance(trivia.init(parsed, PLAYERS, createRng(seed)), T0));
}

describe('seeded RNG', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng('javelin');
    const b = createRng('javelin');
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    const c = createRng('javelin!');
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('shuffles into a permutation without mutating the input', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const copy = [...input];
    const shuffled = seededShuffle(input, 'x');
    expect(input).toEqual(copy);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(input);
    expect(shuffled).not.toEqual(input);
    expect(seededShuffle(input, 'x')).toEqual(shuffled);
  });

  it('draws integers in range and rejects invalid bounds', () => {
    const rng = createRng('ints');
    const seen = new Set(Array.from({ length: 400 }, () => rng.int(4)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });
});

describe('placements', () => {
  it('uses competition ranking with stable tie order', () => {
    expect(rankPlacements(['c', 'a', 'b', 'd'], { a: 10, b: 10, c: 5 })).toEqual([
      { playerId: 'a', score: 10, placement: 1 },
      { playerId: 'b', score: 10, placement: 1 },
      { playerId: 'c', score: 5, placement: 3 },
      { playerId: 'd', score: 0, placement: 4 },
    ]);
  });
});

describe('trivia bank', () => {
  it('holds at least 60 well-formed, unique questions across every category', () => {
    expect(TRIVIA_QUESTIONS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TRIVIA_QUESTIONS.map((q) => q.id)).size).toBe(TRIVIA_QUESTIONS.length);
    expect(new Set(TRIVIA_QUESTIONS.map((q) => q.prompt)).size).toBe(TRIVIA_QUESTIONS.length);
    for (const category of TRIVIA_CATEGORIES) {
      expect(TRIVIA_QUESTIONS.filter((q) => q.category === category).length).toBeGreaterThanOrEqual(
        8,
      );
    }
    for (const q of TRIVIA_QUESTIONS) {
      const options = [q.correct, ...q.distractors];
      expect(new Set(options).size, q.id).toBe(4);
      // Options become Discord button labels (≤ 80 characters).
      for (const option of options)
        expect(option.length, `${q.id}: ${option}`).toBeLessThanOrEqual(80);
      expect(q.prompt.length, q.id).toBeLessThanOrEqual(200);
      expect(q.fact.length, q.id).toBeLessThanOrEqual(160);
      expect(q.id).toMatch(/^[a-z]+-\d{2}$/);
    }
  });
});

describe('trivia engine', () => {
  it('validates config bounds and filters', () => {
    expect(triviaConfigSchema.parse({})).toMatchObject({
      rounds: 10,
      secondsPerQuestion: 20,
      difficulty: 'mixed',
    });
    for (const bad of [
      { rounds: 4 },
      { rounds: 16 },
      { secondsPerQuestion: 9 },
      { secondsPerQuestion: 31 },
      { rounds: 5.5 },
      { categories: [] },
      { categories: ['astrology'] },
      { categories: ['logic', 'logic'] },
      { unexpected: true },
      { categories: ['logic'], difficulty: 'hard' },
    ]) {
      expect(triviaConfigSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('deals deterministically from the seed, with shuffled options', () => {
    const a = startTrivia('seed-1');
    expect(startTrivia('seed-1')).toEqual(a);
    const b = startTrivia('seed-2');
    expect(b.rounds.map((r) => r.questionId)).not.toEqual(a.rounds.map((r) => r.questionId));
    expect(a.rounds).toHaveLength(5);
    for (const round of a.rounds) {
      const source = TRIVIA_QUESTIONS.find((q) => q.id === round.questionId)!;
      expect([...round.options].sort()).toEqual([source.correct, ...source.distractors].sort());
      expect(round.options[round.correctIndex]).toBe(source.correct);
    }
    const positions = new Set(
      Array.from({ length: 12 }, (_, i) => startTrivia(`s${i}`).rounds[0]!.correctIndex),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it('scores 100 plus a speed bonus of up to 50', () => {
    expect(triviaPoints(true, T0, T0, T0 + 10_000)).toBe(150);
    expect(triviaPoints(true, T0 + 5_000, T0, T0 + 10_000)).toBe(125);
    expect(triviaPoints(true, T0 + 9_999, T0, T0 + 10_000)).toBe(100);
    expect(triviaPoints(false, T0, T0, T0 + 10_000)).toBe(0);
  });

  it('opens the first question at start and hides the answer until the round closes', () => {
    const state = startTrivia();
    expect(state.phase).toBe('question');
    expect(state.closesAt).toBe(T0 + 10_000);
    expect(trivia.nextDeadline(state)).toBe(T0 + 10_000);
    const correct = state.rounds[0]!.correctIndex;
    const answered = trivia.applyMove(state, 'p-alpha', { round: 1, choice: correct }, T0 + 2_000);
    expect(answered).toMatchObject({ round: 1, correct: true, points: 140 });

    for (const viewer of [...PLAYERS, null]) {
      const view = trivia.publicView(roundTrip(answered.state), viewer);
      expect(view.correctIndex).toBeNull();
      expect(view.fact).toBeNull();
      expect(view.scoreboard.every((e) => e.correct === null && e.score === 0)).toBe(true);
      const json = JSON.stringify(view);
      expect(json).not.toContain('correctIndex":' + String(correct));
      expect(json).not.toContain(state.rounds[1]!.prompt);
    }
    const mine = trivia.publicView(answered.state, 'p-alpha').you!;
    expect(mine).toEqual({ answered: true, choice: correct, correct: null, points: null });
    expect(trivia.publicView(answered.state, 'p-beta').you).toEqual({
      answered: false,
      choice: null,
      correct: null,
      points: null,
    });
    expect(trivia.publicView(answered.state, null).you).toBeNull();
  });

  it('closes early when everyone answered, then reveals and commits scores', () => {
    let state = startTrivia();
    const correct = state.rounds[0]!.correctIndex;
    const wrong = (correct + 1) % 4;
    state = trivia.applyMove(state, 'p-alpha', { round: 1, choice: correct }, T0 + 1_000).state;
    state = trivia.applyMove(state, 'p-beta', { round: 1, choice: wrong }, T0 + 1_500).state;
    state = trivia.applyMove(state, 'p-gamma', { round: 1, choice: correct }, T0 + 9_000).state;
    expect(state.phase).toBe('reveal');
    expect(state.revealUntil).toBe(T0 + 9_000 + TRIVIA_REVEAL_MS);
    expect(state.scores).toEqual({ 'p-alpha': 145, 'p-beta': 0, 'p-gamma': 105 });
    const view = trivia.publicView(state, 'p-beta');
    expect(view.correctIndex).toBe(correct);
    expect(view.you).toMatchObject({ correct: false, points: 0 });
    expect(view.scoreboard.map((e) => [e.playerId, e.placement])).toEqual([
      ['p-alpha', 1],
      ['p-gamma', 2],
      ['p-beta', 3],
    ]);
    const next = trivia.advance(state, T0 + 9_000 + TRIVIA_REVEAL_MS);
    expect(next).toMatchObject({ phase: 'question', round: 2 });
  });

  it('BREAK: refuses late, duplicate, future-round and non-player moves', () => {
    const state = startTrivia();
    const move = { round: 1, choice: 0 };
    expect(trivia.validateMove(state, 'intruder', move, T0)).toMatchObject({
      ok: false,
      code: 'not_player',
    });
    expect(trivia.validateMove(state, 'p-alpha', { round: 2, choice: 0 }, T0)).toMatchObject({
      ok: false,
      code: 'wrong_round',
    });
    expect(trivia.validateMove(state, 'p-alpha', move, T0 + 10_000)).toMatchObject({
      ok: false,
      code: 'closed',
    });
    const answered = trivia.applyMove(state, 'p-alpha', move, T0 + 1).state;
    expect(trivia.validateMove(answered, 'p-alpha', { round: 1, choice: 1 }, T0 + 2)).toMatchObject(
      {
        ok: false,
        code: 'duplicate',
      },
    );
    expect(trivia.validateMove(state, 'p-alpha', move, T0 + 9_999)).toEqual({ ok: true });
    expect(trivia.moveSchema.safeParse({ round: 1, choice: 4 }).success).toBe(false);
    expect(trivia.moveSchema.safeParse({ round: 1, choice: 0, correct: true }).success).toBe(false);
  });

  it('a late tick never skips a round', () => {
    const state = startTrivia();
    const late = trivia.advance(state, T0 + 600_000);
    expect(late).toMatchObject({
      phase: 'reveal',
      round: 1,
      revealUntil: T0 + 600_000 + TRIVIA_REVEAL_MS,
    });
    expect(trivia.advance(late, T0 + 600_000)).toBe(late);
    expect(trivia.advance(late, T0 + 600_000 + TRIVIA_REVEAL_MS)).toMatchObject({
      phase: 'question',
      round: 2,
    });
  });

  it('plays a full game deterministically through JSON round trips', () => {
    const play = () => {
      let state = startTrivia('full');
      let now = T0;
      while (!trivia.isFinished(state)) {
        if (state.phase === 'question') {
          const correct = state.rounds[state.round - 1]!.correctIndex;
          state = roundTrip(
            trivia.applyMove(state, 'p-alpha', { round: state.round, choice: correct }, now + 500)
              .state,
          );
          state = roundTrip(
            trivia.applyMove(
              state,
              'p-beta',
              { round: state.round, choice: (correct + 1) % 4 },
              now + 700,
            ).state,
          );
        }
        now = trivia.nextDeadline(state)!;
        state = roundTrip(trivia.advance(state, now));
      }
      return state;
    };
    const final = play();
    expect(final).toEqual(play());
    expect(final.phase).toBe('finished');
    expect(trivia.nextDeadline(final)).toBeNull();
    expect(trivia.scores(final)).toEqual({ 'p-alpha': 5 * 148, 'p-beta': 0, 'p-gamma': 0 });
    expect(trivia.publicView(final, null)).toMatchObject({
      phase: 'finished',
      question: null,
      correctIndex: null,
    });
  });
});

describe('reaction engine', () => {
  const start = (seed = 'r') =>
    roundTrip(
      reaction.advance(
        reaction.init(reactionConfigSchema.parse({ rounds: 3 }), PLAYERS, createRng(seed)),
        T0,
      ),
    );

  it('arms rounds with seeded delays and hides GO until it happens', () => {
    const state: ReactionState = start();
    expect(start()).toEqual(state);
    expect(state.phase).toBe('wait');
    for (const delay of state.delays) {
      expect(delay).toBeGreaterThanOrEqual(1_500);
      expect(delay).toBeLessThanOrEqual(5_000);
    }
    const view = reaction.publicView(state, 'p-alpha');
    expect(view.wentAt).toBeNull();
    expect(view.closesAt).toBeNull();
    expect(JSON.stringify(view)).not.toContain(String(state.goAt));
    expect(JSON.stringify(view)).not.toContain('delays');
  });

  it('punishes false starts and scores fast taps after GO', () => {
    let state = start();
    const falseStart = reaction.applyMove(state, 'p-gamma', { round: 1, action: 'tap' }, T0 + 100);
    expect(falseStart).toMatchObject({ correct: false, points: 0 });
    state = falseStart.state;
    expect(reaction.publicView(state, 'p-gamma').you).toEqual({ tapped: true, falseStart: true });
    expect(reaction.publicView(state, 'p-alpha').results).toBeNull();
    state = reaction.advance(state, state.goAt!);
    expect(state.phase).toBe('go');
    const go = state.wentAt!;
    state = reaction.applyMove(state, 'p-alpha', { round: 1, action: 'tap' }, go + 200).state;
    expect(
      reaction.validateMove(state, 'p-alpha', { round: 1, action: 'tap' }, go + 300),
    ).toMatchObject({
      code: 'duplicate',
    });
    const last = reaction.applyMove(state, 'p-beta', { round: 1, action: 'tap' }, go + 1_000);
    expect(last.points).toBe(50);
    state = last.state;
    expect(state.phase).toBe('reveal');
    expect(state.scores).toEqual({ 'p-alpha': 90, 'p-beta': 50, 'p-gamma': 0 });
    expect(reaction.publicView(state, null).results).toHaveLength(3);
  });

  it('BREAK: a blind tap that triggers GO is timed from the scheduled GO, not from itself', () => {
    const state = start();
    const goAt = state.goAt!;
    const observed = reaction.advance(state, goAt + 400);
    expect(observed).toMatchObject({ phase: 'go', wentAt: goAt });
    const blind = reaction.applyMove(observed, 'p-alpha', { round: 1, action: 'tap' }, goAt + 400);
    expect(blind.points).toBe(80);
    // A late observation never shortens the tap window.
    const late = reaction.advance(state, goAt + 10_000);
    expect(late.closesAt).toBe(goAt + 10_000 + 3_000);
  });
});

describe('registry', () => {
  it('lists the built-in games and rejects duplicates or bad definitions', () => {
    expect(listGames().map((g) => g.key)).toEqual(expect.arrayContaining(['trivia', 'reaction']));
    expect(findGame('trivia')?.name).toBe('Trivia');
    expect(() => registerGame(trivia)).toThrow(/already registered/);
    const base = { ...reaction, key: 'Bad Key' };
    expect(() => registerGame(base)).toThrow(/invalid game key/);
    expect(() => registerGame({ ...base, key: 'zero-players', minPlayers: 0 })).toThrow(
      /player range/,
    );
  });
});
