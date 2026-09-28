import type { ArenaDifficultyWire } from '../api/contract';
import { enumLabel } from './format';

/** Round counts the Open Lobby form offers (the engine accepts 5–15). */
export const ROUND_COUNTS = [5, 10, 15] as const;
export type RoundCount = (typeof ROUND_COUNTS)[number];
export const DEFAULT_ROUND_COUNT: RoundCount = 10;
/** Picked first when the server offers it. */
export const PREFERRED_DIFFICULTY = 'mixed';

export interface LobbyChoice<T extends string | number> {
  value: T;
  label: string;
  disabled: boolean;
}

/**
 * The difficulties the server says the question bank can fill, in the
 * server's order. Nothing else is ever offered, so no choice always fails.
 */
export function difficultyChoices(offered: readonly ArenaDifficultyWire[]): LobbyChoice<string>[] {
  return offered.map(({ value }) => ({ value, label: enumLabel(value), disabled: false }));
}

/** The chosen difficulty while the server still offers it, else the preferred one, else the first. */
export function effectiveDifficulty(
  offered: readonly ArenaDifficultyWire[],
  chosen: string | null,
): string | null {
  const has = (value: string | null) => offered.some((option) => option.value === value);
  if (has(chosen)) return chosen;
  if (has(PREFERRED_DIFFICULTY)) return PREFERRED_DIFFICULTY;
  return offered[0]?.value ?? null;
}

/** Most rounds the bank can fill at this difficulty; 0 when it is not offered. */
export function maxRoundsAt(offered: readonly ArenaDifficultyWire[], difficulty: string | null) {
  return offered.find((option) => option.value === difficulty)?.maxRounds ?? 0;
}

/** Every round count, with the ones this difficulty cannot fill disabled. */
export function roundChoices(maxRounds: number): LobbyChoice<RoundCount>[] {
  return ROUND_COUNTS.map((value) => ({
    value,
    label: String(value),
    disabled: value > maxRounds,
  }));
}

/**
 * The chosen round count when the difficulty can fill it, otherwise the
 * largest that fits (the choice comes back when the difficulty allows it
 * again). Null when no count fits.
 */
export function fitRounds(chosen: RoundCount, maxRounds: number): RoundCount | null {
  if (chosen <= maxRounds) return chosen;
  const fitting = ROUND_COUNTS.filter((value) => value <= maxRounds);
  return fitting.at(-1) ?? null;
}
