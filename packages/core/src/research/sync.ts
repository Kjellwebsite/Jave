import { eq } from 'drizzle-orm';
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

async function record(ctx: ServiceContext, itemId: string, state: SyncState): Promise<void> {
  await ctx.db
    .update(researchItems)
    .set({ ...state, updatedAt: ctx.clock.now() })
    .where(eq(researchItems.id, itemId));
}

/**
 * Job body for `research.sync_sidus`. Transitions sidus_sync_status:
 * pending → synced | not_synced (not configured / no longer verified) |
 * failed (after the last retry or a non-retryable error).
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
  if (item.status !== 'verified') {
    await record(ctx, itemId, {
      sidusSyncStatus: 'not_synced',
      sidusSyncError: 'Only VERIFIED items sync to Sidus.',
    });
    return { itemId, synced: false, reason: 'not_verified' };
  }
  try {
    const { externalId } = await client.pushItem(toSidusItem(item));
    await record(ctx, itemId, {
      sidusSyncStatus: 'synced',
      sidusExternalId: externalId,
      sidusSyncedAt: ctx.clock.now(),
      sidusSyncError: null,
    });
    return { itemId, synced: true };
  } catch (error) {
    if (error instanceof SidusNotConfiguredError) {
      await record(ctx, itemId, {
        sidusSyncStatus: 'not_synced',
        sidusSyncError: SIDUS_NOT_CONFIGURED_REASON,
      });
      return { itemId, synced: false, reason: 'not_configured' };
    }
    const reason = error instanceof SidusSyncError ? error.message : 'Unexpected Sidus error.';
    const retryable = !(error instanceof SidusSyncError) || error.retryable;
    const final = !retryable || attempt.attempt >= attempt.maxAttempts;
    await record(ctx, itemId, {
      sidusSyncStatus: final ? 'failed' : 'pending',
      sidusSyncError: truncate(reason, MAX_SYNC_ERROR_LENGTH),
    });
    if (!final) throw error;
    ctx.logger.warn({ itemId, reason }, 'sidus sync failed');
    return { itemId, synced: false, reason: 'failed' };
  }
}
