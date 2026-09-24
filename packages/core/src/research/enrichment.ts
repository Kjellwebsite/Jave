import { eq } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { PermanentJobError } from '../jobs/worker';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { truncate } from '../kernel/redact';
import { loadItem, type ResearchItemRecord } from './model';
import {
  type MetadataResolver,
  MetadataResolverError,
  type ResolvedMetadata,
} from './metadata/types';

export interface JobAttempt {
  attempt: number;
  maxAttempts: number;
}

type EnrichmentOutcome =
  | { status: 'enriched'; metadata: ResolvedMetadata }
  | { status: 'not_found' | 'skipped' }
  | { status: 'failed'; error: string };

const MAX_ENRICHMENT_ERROR_LENGTH = 300;

/** Fill only what is missing; a guessed title yields to the source's title. */
function metadataPatch(item: ResearchItemRecord, metadata: ResolvedMetadata) {
  return {
    ...(item.titleGuessed && metadata.title && { title: metadata.title, titleGuessed: false }),
    ...(item.authors.length === 0 && metadata.authors.length > 0 && { authors: metadata.authors }),
    ...(!item.source && metadata.source && { source: metadata.source }),
    ...(!item.publishedOn && metadata.publishedOn && { publishedOn: metadata.publishedOn }),
    ...(!item.summary && metadata.abstract && { summary: metadata.abstract }),
  };
}

async function finish(
  ctx: ServiceContext,
  itemId: string,
  outcome: EnrichmentOutcome,
): Promise<Record<string, unknown>> {
  return withTransaction(ctx, async (tx) => {
    // Re-read under lock: a member may have edited the item while we were fetching.
    const item = await loadItem(tx, itemId, { forUpdate: true });
    const now = tx.clock.now();
    await tx.db
      .update(researchItems)
      .set({
        ...(outcome.status === 'enriched' && metadataPatch(item, outcome.metadata)),
        enrichmentStatus: outcome.status,
        enrichedAt: now,
        enrichmentError:
          outcome.status === 'failed' ? truncate(outcome.error, MAX_ENRICHMENT_ERROR_LENGTH) : null,
        ...(item.status === 'new' && { status: 'needs_review' as const }),
        updatedAt: now,
      })
      .where(eq(researchItems.id, itemId));
    return { itemId, enrichment: outcome.status };
  });
}

/**
 * Job body for `research.enrich`: resolve DOI (Crossref) or arXiv metadata,
 * fill missing fields, and move NEW → NEEDS REVIEW. Transient failures retry
 * via the job queue; the final attempt records `failed` instead of throwing.
 */
export async function enrichResearchItem(
  ctx: ServiceContext,
  resolvers: readonly MetadataResolver[],
  itemId: string,
  attempt: JobAttempt,
): Promise<Record<string, unknown>> {
  const item = await loadItem(ctx, itemId).catch(() => {
    throw new PermanentJobError(`research item ${itemId} not found`);
  });
  if (item.enrichmentStatus !== 'pending') return { itemId, skipped: 'already_processed' };
  const target = item.doi
    ? { kind: 'doi' as const, id: item.doi }
    : item.arxivId
      ? { kind: 'arxiv' as const, id: item.arxivId }
      : null;
  const resolver = target && resolvers.find((r) => r.kind === target.kind);
  if (!target || !resolver) return finish(ctx, itemId, { status: 'skipped' });
  try {
    const metadata = await resolver.resolve(target.id);
    return finish(
      ctx,
      itemId,
      metadata ? { status: 'enriched', metadata } : { status: 'not_found' },
    );
  } catch (error) {
    const retryable = !(error instanceof MetadataResolverError) || error.retryable;
    if (retryable && attempt.attempt < attempt.maxAttempts) throw error;
    const reason = error instanceof MetadataResolverError ? error.message : 'unexpected error';
    ctx.logger.warn({ itemId, resolver: resolver.name, reason }, 'research enrichment failed');
    return finish(ctx, itemId, { status: 'failed', error: reason });
  }
}
