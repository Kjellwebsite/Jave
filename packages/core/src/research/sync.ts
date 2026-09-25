import { and, eq } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { PermanentJobError } from '../jobs/worker';
import type { ServiceContext } from '../kernel/context';
import { truncate } from '../kernel/redact';
import type { JobAttempt } from './enrichment';
import { isDiscordUrl } from './extraction';
import { loadItem, type ResearchItemRecord } from './model';
import {
  SIDUS_NOT_CONFIGURED_REASON,
  type SidusClient,
  SidusNotConfiguredError,
  type SidusResearchItem,
  SidusSyncError,
} from './sidus';

const MAX_SYNC_ERROR_LENGTH = 300;
const NOT_VERIFIED_REASON = 'Only VERIFIED items sync to Sidus.';
export const CHANGED_DURING_SYNC_REASON =
  'The item kept changing during the sync. Request a sync again.';

/** Discord links (messages, signed CDN attachments) may point into private channels. */
function publicLink(url: string | null): string | null {
  return url && !isDiscordUrl(url) ? url : null;
}

/**
 * The payload JAVE sends to Sidus for an item. No member identity and no
 * Discord links leave JAVE.
 */
export function toSidusItem(item: ResearchItemRecord): SidusResearchItem {
  return {
    externalRef: item.id,
    title: item.title,
    authors: item.authors,
    doi: item.doi,
    arxivId: item.arxivId,
    url: publicLink(item.url),
    canonicalUrl: publicLink(item.canonicalUrl),
    topic: item.topic,
    tags: item.tags,
    summary: item.summary,
    evidenceLevel: item.evidenceLevel,
    publishedOn: item.publishedOn,
    verifiedAt: item.reviewedAt?.toISOString() ?? null,
    source: 'jave',
  };
}

type SyncState = Pick<
  typeof researchItems.$inferInsert,
  'sidusSyncStatus' | 'sidusExternalId' | 'sidusSyncedAt' | 'sidusSyncError'
>;

interface SyncOutcome {
  state: SyncState;
  result: Record<string, unknown>;
  /** A transient failure: rethrown after recording so the queue retries. */
  retry?: unknown;
}

/** Push the item (or explain why not). Never throws for Sidus failures. */
async function attemptSync(
  ctx: ServiceContext,
  client: SidusClient,
  item: ResearchItemRecord,
  attempt: JobAttempt,
): Promise<SyncOutcome> {
  const itemId = item.id;
  if (item.status !== 'verified') {
    return {
      state: { sidusSyncStatus: 'not_synced', sidusSyncError: NOT_VERIFIED_REASON },
      result: { itemId, synced: false, reason: 'not_verified' },
    };
  }
  try {
    const { externalId } = await client.pushItem(toSidusItem(item));
    return {
      state: {
        sidusSyncStatus: 'synced',
        sidusExternalId: externalId,
        sidusSyncedAt: ctx.clock.now(),
        sidusSyncError: null,
      },
      result: { itemId, synced: true, version: item.version },
    };
  } catch (error) {
    if (error instanceof SidusNotConfiguredError) {
      return {
        state: { sidusSyncStatus: 'not_synced', sidusSyncError: SIDUS_NOT_CONFIGURED_REASON },
        result: { itemId, synced: false, reason: 'not_configured' },
      };
    }
    const reason = error instanceof SidusSyncError ? error.message : 'Unexpected Sidus error.';
    const retryable = !(error instanceof SidusSyncError) || error.retryable;
    const final = !retryable || attempt.attempt >= attempt.maxAttempts;
    if (final) ctx.logger.warn({ itemId, reason }, 'sidus sync failed');
    return {
      state: {
        sidusSyncStatus: final ? 'failed' : 'pending',
        sidusSyncError: truncate(reason, MAX_SYNC_ERROR_LENGTH),
      },
      result: { itemId, synced: false, reason: 'failed' },
      ...(!final && { retry: error }),
    };
  }
}

/** Record the outcome only if the item is still the version this job pushed. */
async function recordForVersion(
  ctx: ServiceContext,
  item: ResearchItemRecord,
  state: SyncState,
): Promise<boolean> {
  const rows = await ctx.db
    .update(researchItems)
    .set({ ...state, updatedAt: ctx.clock.now() })
    .where(and(eq(researchItems.id, item.id), eq(researchItems.version, item.version)))
    .returning({ id: researchItems.id });
  return rows.length > 0;
}

/**
 * Job body for `research.sync_sidus`. Transitions sidus_sync_status:
 * pending → synced | not_synced (not configured / no longer verified) |
 * failed (after the last retry or a non-retryable error).
 *
 * Every outcome is recorded only for the content version that was pushed.
 * When the item changed while the push was in flight, the job retries and
 * pushes the latest content, so Sidus never keeps an older version marked
 * as synced.
 */
export async function syncResearchItemToSidus(
  ctx: ServiceContext,
  client: SidusClient,
  itemId: string,
  attempt: JobAttempt,
): Promise<Record<string, unknown>> {
  const item = await loadItem(ctx, itemId).catch(() => {
    throw new PermanentJobError(`research item ${itemId} not found`);
  });
  const outcome = await attemptSync(ctx, client, item, attempt);
  if (await recordForVersion(ctx, item, outcome.state)) {
    if (outcome.retry !== undefined) throw outcome.retry;
    return outcome.result;
  }
  if (attempt.attempt < attempt.maxAttempts) {
    throw new Error(
      'research item changed during the Sidus sync; retrying with the latest version',
    );
  }
  // Out of attempts. Leave a newer job's result alone; otherwise say so.
  await ctx.db
    .update(researchItems)
    .set({
      sidusSyncStatus: 'failed',
      sidusSyncError: CHANGED_DURING_SYNC_REASON,
      updatedAt: ctx.clock.now(),
    })
    .where(and(eq(researchItems.id, itemId), eq(researchItems.sidusSyncStatus, 'pending')));
  return { itemId, synced: false, reason: 'superseded' };
}
