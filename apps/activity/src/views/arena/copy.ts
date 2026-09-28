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

/**
 * Time per question a host can pick (the engine accepts 10–30 s). Round
 * counts and difficulties come from `lib/lobby.ts`: which of them the
 * question bank can fill is the server's call.
 */
export const PACE_CHOICES = [
  { value: 10, label: '10 S' },
  { value: 20, label: '20 S' },
  { value: 30, label: '30 S' },
] as const;

export type PaceChoice = (typeof PACE_CHOICES)[number]['value'];

export const DEFAULT_PACE: PaceChoice = 20;

/** Why a session ended, in the Arena's voice. Host-written reasons are shown as given. */
export function endReasonText(reason: string | null): string {
  if (!reason || reason === 'finished') return 'The session ended.';
  return reason;
}
