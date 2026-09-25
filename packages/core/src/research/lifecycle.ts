import { sql } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { enqueueJob } from '../jobs/queue';
import type { ServiceContext } from '../kernel/context';
import { ConflictError, ForbiddenError } from '../kernel/errors';
import { RESEARCH_SYNC_SIDUS_JOB, SIDUS_SYNC_MAX_ATTEMPTS } from './constants';
import type { ResearchItemRecord, ResearchStatus } from './model';

/**
 * Review-integrity rules shared by edits, reviews and the Sidus sync: which
 * changes invalidate a review, how the content revision moves, and how a
 * change to a verified item reaches Sidus.
 */

/** Fields members and reviewers can change after saving. */
export type ItemField =
  | 'title'
  | 'authors'
  | 'source'
  | 'url'
  | 'doi'
  | 'arxivId'
  | 'publishedOn'
  | 'topic'
  | 'tags'
  | 'summary'
  | 'evidenceLevel';

export type ItemEdits = Partial<Pick<ResearchItemRecord, ItemField>>;

/**
 * What the reference is. A review attests to these, so changing one sends a
 * REVIEWED or VERIFIED item back to NEEDS REVIEW, whoever changes it.
 */
const REFERENCE_FIELDS: ReadonlySet<ItemField> = new Set([
  'title',
  'authors',
  'source',
  'url',
  'doi',
  'arxivId',
  'publishedOn',
]);

/** Fields sent to Sidus (see `toSidusItem`); a change to a verified item re-pushes it. */
const SIDUS_FIELDS: ReadonlySet<ItemField> = new Set([
  'title',
  'authors',
  'url',
  'doi',
  'arxivId',
  'publishedOn',
  'topic',
  'tags',
  'summary',
  'evidenceLevel',
]);

export const SIDUS_STALE_REASON = 'Changed since the last Sidus sync. Request a sync to update it.';

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

/** The edited fields whose value actually differs from the item. */
export function changedFields(item: ResearchItemRecord, edits: ItemEdits): ItemField[] {
  return (Object.keys(edits) as ItemField[]).filter(
    (field) => edits[field] !== undefined && !sameValue(item[field], edits[field]),
  );
}

export function touchesReference(fields: readonly ItemField[]): boolean {
  return fields.some((field) => REFERENCE_FIELDS.has(field));
}

export function touchesSidus(fields: readonly ItemField[]): boolean {
  return fields.some((field) => SIDUS_FIELDS.has(field));
}

/**
 * Status after an edit. A submitter's change to a REVIEWED item reopens it
 * (their VERIFIED items are locked before this point); anyone's change to the
 * reference itself reopens a REVIEWED or VERIFIED item. Reviewers may curate
 * topic, tags and summary without reopening.
 */
export function statusAfterEdit(
  status: ResearchStatus,
  changed: readonly ItemField[],
  bySubmitter: boolean,
): ResearchStatus {
  if (status !== 'reviewed' && status !== 'verified') return status;
  return bySubmitter || touchesReference(changed) ? 'needs_review' : status;
}

/** SQL for the next content revision. */
export function nextVersion() {
  return sql`${researchItems.version} + 1`;
}

/** Surfaces send the version they rendered; acting on anything newer is refused. */
export function assertVersion(
  item: ResearchItemRecord,
  expected: number | undefined,
  message: string,
): void {
  if (expected !== undefined && expected !== item.version) {
    throw new ConflictError(message, { expectedVersion: expected, version: item.version });
  }
}

type SyncState = Pick<typeof researchItems.$inferInsert, 'sidusSyncStatus' | 'sidusSyncError'>;

/**
 * Sync bookkeeping for a change that leaves the item VERIFIED (a new
 * verification, or a verified item whose Sidus fields changed). With
 * auto-sync the push is queued; without it, an item Sidus already holds is
 * marked stale instead of claiming to be synced.
 */
export function syncStateAfterChange(
  autoSync: boolean,
  current: ResearchItemRecord['sidusSyncStatus'],
): SyncState {
  if (autoSync) return { sidusSyncStatus: 'pending', sidusSyncError: null };
  if (current === 'synced')
    return { sidusSyncStatus: 'not_synced', sidusSyncError: SIDUS_STALE_REASON };
  return {};
}

/**
 * Queue the Sidus push for one content revision. A newer revision gets its
 * own job even while an older one is running; the job always pushes the
 * latest content and only records its outcome for the revision it pushed.
 */
export async function queueSidusSync(
  ctx: ServiceContext,
  item: Pick<ResearchItemRecord, 'id' | 'version'>,
): Promise<void> {
  await enqueueJob(
    ctx,
    RESEARCH_SYNC_SIDUS_JOB,
    { itemId: item.id },
    {
      dedupeKey: `research:sidus:${item.id}:v${item.version}`,
      maxAttempts: SIDUS_SYNC_MAX_ATTEMPTS,
    },
  );
}

const SELF_REVIEW_MESSAGES = {
  review: 'You cannot review your own submission. Another reviewer must.',
  sidus_sync: 'Another reviewer must sync your own submission to Sidus.',
} as const;

/** Nobody reviews or publishes their own submission. The attempt is audited. */
export async function refuseSelfReview(
  ctx: ServiceContext,
  item: ResearchItemRecord,
  attempted: keyof typeof SELF_REVIEW_MESSAGES,
): Promise<never> {
  await recordAudit(
    ctx,
    {
      action: 'research.self_review_blocked',
      targetType: 'research_item',
      targetId: item.id,
      context: { attempted },
      result: 'denied',
    },
    { durable: true },
  );
  throw new ForbiddenError(SELF_REVIEW_MESSAGES[attempted]);
}
