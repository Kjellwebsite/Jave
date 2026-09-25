import { and, eq } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, InvalidStateError, ValidationError } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { notify } from '../notifications/notifications.service';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import {
  assertVersion,
  changedFields,
  type ItemEdits,
  nextVersion,
  queueSidusSync,
  refuseSelfReview,
  syncStateAfterChange,
  touchesSidus,
} from './lifecycle';
import {
  assertTransition,
  isSubmitter,
  loadItem,
  memberIdForUser,
  type ResearchItemView,
  STATUS_LABELS,
  toView,
} from './model';
import { itemIdSchema, type ReviewResearchItemInput, reviewResearchItemSchema } from './schemas';

const TITLE_IN_NOTIFICATION = 120;
const CONCURRENT_CHANGE_MESSAGE =
  'This item changed while you were reviewing it. Reload and review again.';
const CONCURRENT_SYNC_MESSAGE = 'This item changed. Reload and request the sync again.';

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  unknown: 'UNKNOWN',
  anecdotal: 'ANECDOTAL',
  observational: 'OBSERVATIONAL',
  experimental: 'EXPERIMENTAL',
  peer_reviewed: 'PEER REVIEWED',
  meta_analysis: 'META-ANALYSIS',
};

/**
 * Reviewer decision: status, evidence level, topic, tags and summary.
 * Nobody reviews their own submission. The decision applies to the version
 * the reviewer saw (`expectedVersion`): any change since — an edit, an
 * enrichment, another review — is a ConflictError. VERIFIED requires a known
 * evidence level; with auto-sync on, a new verification or a change to a
 * verified item's Sidus fields queues the Sidus push.
 */
export async function reviewResearchItem(
  ctx: ServiceContext,
  input: ReviewResearchItemInput,
): Promise<ResearchItemView> {
  const data = parseInput(reviewResearchItemSchema, input);
  const target = { type: 'research_item', id: data.itemId };
  await authorize(ctx, 'canReviewResearch', target);
  const item = await loadItem(ctx, data.itemId);
  if (isSubmitter(ctx, item)) await refuseSelfReview(ctx, item, 'review');
  assertVersion(item, data.expectedVersion, CONCURRENT_CHANGE_MESSAGE);
  if (item.status === 'archived' && data.status !== 'needs_review') {
    throw new InvalidStateError('Archived items must be restored to NEEDS REVIEW first.');
  }
  const nextStatus = data.status ?? item.status;
  if (nextStatus !== item.status) assertTransition(item.status, nextStatus);
  const nextEvidence = data.evidenceLevel ?? item.evidenceLevel;
  if (nextStatus === 'verified' && nextEvidence === 'unknown') {
    throw new ValidationError('Set an evidence level before verifying.');
  }
  const edits: ItemEdits = {
    evidenceLevel: nextEvidence,
    ...(data.topic !== undefined && { topic: data.topic }),
    ...(data.tags !== undefined && { tags: data.tags }),
    ...(data.summary !== undefined && { summary: data.summary || null }),
  };
  const becameVerified = nextStatus === 'verified' && item.status !== 'verified';
  const pushable =
    nextStatus === 'verified' && (becameVerified || touchesSidus(changedFields(item, edits)));
  const { sidusAutoSync } = await getSettings(ctx, 'integrations');
  const reviewerId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [row] = await tx.db
      .update(researchItems)
      .set({
        ...edits,
        status: nextStatus,
        ...(pushable && syncStateAfterChange(sidusAutoSync, item.sidusSyncStatus)),
        reviewedByUserId: reviewerId,
        reviewedAt: now,
        version: nextVersion(),
        updatedAt: now,
      })
      // Optimistic guard: the reviewer decides on exactly the version they saw.
      .where(and(eq(researchItems.id, item.id), eq(researchItems.version, item.version)))
      .returning();
    if (!row) throw new ConflictError(CONCURRENT_CHANGE_MESSAGE);
    const submitterMemberId = await memberIdForUser(tx, item.submittedByUserId);
    await recordAudit(tx, {
      action: 'research.reviewed',
      targetType: 'research_item',
      targetId: item.id,
      context: {
        from: item.status,
        to: nextStatus,
        evidenceLevel: nextEvidence,
        version: item.version,
        note: data.note ?? null,
      },
    });
    await publishEvent(tx, {
      type: 'research.reviewed',
      aggregateType: 'research_item',
      aggregateId: item.id,
      subjectMemberId: submitterMemberId,
      payload: { from: item.status, to: nextStatus, evidenceLevel: nextEvidence },
    });
    if (becameVerified) {
      await publishEvent(tx, {
        type: 'research.verified',
        aggregateType: 'research_item',
        aggregateId: item.id,
        subjectMemberId: submitterMemberId,
        payload: { evidenceLevel: nextEvidence, doi: row.doi, arxivId: row.arxivId },
      });
    }
    if (pushable && sidusAutoSync) await queueSidusSync(tx, row);
    if (nextStatus !== item.status && (nextStatus === 'reviewed' || nextStatus === 'verified')) {
      await notify(tx, {
        recipientUserId: item.submittedByUserId,
        type: 'research.reviewed',
        title: `RESEARCH ${STATUS_LABELS[nextStatus]}`,
        body: `${truncate(row.title, TITLE_IN_NOTIFICATION)} — evidence: ${EVIDENCE_LABELS[nextEvidence] ?? 'UNKNOWN'}.`,
        data: { itemId: item.id, status: nextStatus, evidenceLevel: nextEvidence },
        dedupeKey: `research:${item.id}:status:${nextStatus}:${now.getTime()}`,
      });
    }
    return toView(row);
  });
}

/**
 * Queue (or re-queue) the Sidus push for a verified item. Reviewers only,
 * and never for their own submission.
 */
export async function requestSidusSync(
  ctx: ServiceContext,
  input: { itemId: string },
): Promise<ResearchItemView> {
  const { itemId } = parseInput(itemIdSchema, input);
  await authorize(ctx, 'canReviewResearch', { type: 'research_item', id: itemId });
  const item = await loadItem(ctx, itemId);
  if (isSubmitter(ctx, item)) await refuseSelfReview(ctx, item, 'sidus_sync');
  if (item.status !== 'verified') {
    throw new InvalidStateError('Only VERIFIED items sync to Sidus.');
  }
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(researchItems)
      .set({ sidusSyncStatus: 'pending', sidusSyncError: null, updatedAt: tx.clock.now() })
      // Still the verified version checked above.
      .where(and(eq(researchItems.id, item.id), eq(researchItems.version, item.version)))
      .returning();
    if (!row) throw new ConflictError(CONCURRENT_SYNC_MESSAGE);
    await recordAudit(tx, {
      action: 'research.sidus_sync_requested',
      targetType: 'research_item',
      targetId: item.id,
      context: { version: item.version },
    });
    await queueSidusSync(tx, row);
    return toView(row);
  });
}
