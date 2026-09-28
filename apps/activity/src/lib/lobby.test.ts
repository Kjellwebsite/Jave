import { describe, expect, it } from 'vitest';
import type { ArenaDifficultyWire } from '../api/contract';
import {
  difficultyChoices,
  effectiveDifficulty,
  fitRounds,
  maxRoundsAt,
  roundChoices,
  ROUND_COUNTS,
} from './lobby';

const OFFERED: ArenaDifficultyWire[] = [
  { value: 'mixed', maxRounds: 15 },
  { value: 'easy', maxRounds: 15 },
  { value: 'hard', maxRounds: 12 },
];

describe('Open Lobby choices', () => {
  it('offers only the difficulties the server can fill, in its order', () => {
    expect(difficultyChoices(OFFERED).map((choice) => [choice.value, choice.label])).toEqual([
      ['mixed', 'MIXED'],
      ['easy', 'EASY'],
      ['hard', 'HARD'],
    ]);
    expect(difficultyChoices([])).toEqual([]);
  });

  it('keeps a chosen difficulty while it is offered, else falls back to mixed, then the first', () => {
    expect(effectiveDifficulty(OFFERED, 'easy')).toBe('easy');
    expect(effectiveDifficulty(OFFERED, null)).toBe('mixed');
    expect(effectiveDifficulty(OFFERED, 'medium')).toBe('mixed');
    expect(effectiveDifficulty([{ value: 'easy', maxRounds: 15 }], 'hard')).toBe('easy');
    expect(effectiveDifficulty([], 'mixed')).toBeNull();
  });

  it('disables the round counts the difficulty cannot fill', () => {
    expect(maxRoundsAt(OFFERED, 'hard')).toBe(12);
    expect(maxRoundsAt(OFFERED, 'medium')).toBe(0);
    expect(roundChoices(12).map((choice) => [choice.value, choice.disabled])).toEqual([
      [5, false],
      [10, false],
      [15, true],
    ]);
    expect(roundChoices(15).every((choice) => !choice.disabled)).toBe(true);
    expect(roundChoices(0).every((choice) => choice.disabled)).toBe(true);
  });

  it('fits the chosen round count to the difficulty without forgetting it', () => {
    expect(fitRounds(15, 15)).toBe(15);
    expect(fitRounds(15, 12)).toBe(10);
    expect(fitRounds(10, 12)).toBe(10);
    expect(fitRounds(5, 7)).toBe(5);
    expect(fitRounds(10, 4)).toBeNull();
    expect(ROUND_COUNTS).toEqual([5, 10, 15]);
  });
});
