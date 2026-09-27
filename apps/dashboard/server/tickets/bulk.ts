import { isUuid, ValidationError } from '@jave/core';
import { BULK_LIMIT } from '@/lib/ticket-view';

export type BulkResult = { ok: true; reference: string } | { ok: false; message: string };

/** Failure reasons listed in a partial-success message. */
const LISTED_FAILURES = 2;

/**
 * Selected ticket ids from the bulk form: comma-separated UUIDs, de-duplicated,
 * at most one page. Anything malformed is a validation error, never ignored.
 */
export function parseTicketIds(raw: string): string[] {
  const ids = [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) throw new ValidationError('Select at least one ticket.');
  if (ids.length > BULK_LIMIT) {
    throw new ValidationError(`Select at most ${BULK_LIMIT} tickets at a time.`);
  }
  if (!ids.every(isUuid)) throw new ValidationError('The selection is no longer valid. Reload.');
  return ids;
}

/**
 * One calm line for a bulk run: "CLAIMED 3 OF 4 — #0012, #0013, #0014. 1 refused:
 * Already claimed by another handler." Not ok when nothing succeeded.
 */
export function bulkOutcome(
  verb: string,
  results: readonly BulkResult[],
): { ok: boolean; message: string } {
  const done = results.filter((r): r is Extract<BulkResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<BulkResult, { ok: false }> => !r.ok);
  const reasons = [...new Set(failed.map((r) => r.message))].slice(0, LISTED_FAILURES).join(' ');
  if (done.length === 0) {
    return { ok: false, message: `Nothing ${verb.toLowerCase()}. ${reasons}`.trim() };
  }
  const head = `${verb} ${done.length} OF ${results.length} — ${done.map((r) => r.reference).join(', ')}.`;
  return {
    ok: true,
    message: failed.length === 0 ? head : `${head} ${failed.length} refused: ${reasons}`,
  };
}
