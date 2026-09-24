import { ValidationError } from '../kernel/errors';

/**
 * Display ordering shared by links and milestones. Ordinals are clamped
 * below the smallint limit; items that share the ceiling still sort by
 * creation time, so new items stay last.
 */
export const ORDINAL_CEILING = 30_000;

/** Upper bound for id lists in reorder requests. */
export const MAX_REORDER_IDS = 100;

export function nextOrdinal(last: number | null | undefined): number {
  return Math.min((last ?? -1) + 1, ORDINAL_CEILING);
}

/** Every existing id exactly once, nothing else. */
export function assertExactPermutation(
  existing: readonly string[],
  ordered: readonly string[],
): void {
  const expected = new Set(existing);
  const seen = new Set(ordered);
  if (
    ordered.length !== existing.length ||
    seen.size !== ordered.length ||
    ordered.some((id) => !expected.has(id))
  ) {
    throw new ValidationError('Provide every item of this project exactly once.');
  }
}
