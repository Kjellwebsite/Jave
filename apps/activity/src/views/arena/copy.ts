import type { TriviaConfigWire } from '../../api/contract';
import { enumLabel } from '../../lib/format';

/** Shown wherever the rules matter: points are game points, never capability. */
export const SCORING_NOTE =
  'A correct answer scores 100, plus up to 50 for speed. Arena results never change capability ranks.';

/** `10 ROUNDS · 20 S PER QUESTION · MIXED` */
export function configSummary(config: TriviaConfigWire): string {
  return `${config.rounds} ROUNDS · ${config.secondsPerQuestion} S PER QUESTION · ${enumLabel(
    config.difficulty,
  )}`;
}

/** Lobby settings a host can pick. Ranges are enforced by the server. */
export const ROUND_CHOICES = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
] as const;

export const PACE_CHOICES = [
  { value: 10, label: '10 S' },
  { value: 20, label: '20 S' },
  { value: 30, label: '30 S' },
] as const;

export const DIFFICULTY_CHOICES = [
  { value: 'mixed', label: 'MIXED' },
  { value: 'easy', label: 'EASY' },
  { value: 'medium', label: 'MEDIUM' },
  { value: 'hard', label: 'HARD' },
] as const;

export type RoundChoice = (typeof ROUND_CHOICES)[number]['value'];
export type PaceChoice = (typeof PACE_CHOICES)[number]['value'];
export type DifficultyChoice = (typeof DIFFICULTY_CHOICES)[number]['value'];

export const DEFAULT_ROUNDS: RoundChoice = 10;
export const DEFAULT_PACE: PaceChoice = 20;
export const DEFAULT_DIFFICULTY: DifficultyChoice = 'mixed';

/** Why a session ended, in the Arena's voice. Host-written reasons are shown as given. */
export function endReasonText(reason: string | null): string {
  if (!reason || reason === 'finished') return 'The session ended.';
  return reason;
}
