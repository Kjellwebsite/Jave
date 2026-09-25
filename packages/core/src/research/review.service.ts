import { and, eq } from 'drizzle-orm';
import { researchItems } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { type ServiceContext, withTransaction } from '../kernel/context';
import {
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  ValidationError,
} from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { notify } from '../notifications/notifications.service';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { RESEARCH_SYNC_SIDUS_JOB, SIDUS_SYNC_MAX_ATTEMPTS } from './constants';
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

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  unknown: 'UNKNOWN',
  anecdotal: 'ANECDOTAL',
  observational: 'OBSERVATIONAL',
  experimental: 'EXPERIMENTAL',
  peer_reviewed: 'PEER REVIEWED',
  meta_analysis: 'META-ANALYSIS',
};

async function enqueueSidusSync(ctx: ServiceContext, itemId: string): Promise<void> {
  await enqueueJob(
    ctx,
    RESEARCH_SYNC_SIDUS_JOB,
    { itemId },
    { dedupeKey: `research:sidus:${itemId}`, maxAttempts: SIDUS_SYNC_MAX_ATTEMPTS },
  );
}

/**
 * Reviewer decision: status, evidence level, topic, tags and summary.
 * Nobody reviews their own submission. VERIFIED requires a known evidence
 * level and, when auto-sync is on, queues the Sidus push.
 */
export async function reviewResearchItem(
  ctx: ServiceContext,
  input: ReviewResearchItemInput,
): Promise<ResearchItemView> {
  const data = parseInput(reviewResearchItemSchema, input);
  const target = { type: 'research_item', id: data.itemId };
  await authorize(ctx, 'canReviewResearch', target);
  const item = await loadItem(ctx, data.itemId);
  if (isSubmitter(ctx, item)) {
    await recordAudit(
      ctx,
      {
        action: 'research.self_review_blocked',
        targetType: 'research_item',
        targetId: item.id,
        result: 'denied',
      },
      { durable: true },
    );
    throw new ForbiddenError('You cannot review your own submission. Another reviewer must.');
  }
  if (item.status === 'archived' && data.status !== 'needs_review') {
    throw new InvalidStateError('Archived items must be restored to NEEDS REVIEW first.');
  }
  const nextStatus = data.status ?? item.status;
  if (nextStatus !== item.status) assertTransition(item.status, nextStatus);
  const nextEvidence = data.evidenceLevel ?? item.evidenceLevel;
  if (nextStatus === 'verified' && nextEvidence === 'unknown') {
    throw new ValidationError('Set an evidence level before verifying.');
  }
  const becameVerified = nextStatus === 'verified' && item.status !== 'verified';
  const { sidusAutoSync } = await getSettings(ctx, 'integrations');
  const reviewerId = ctx.actor.kind === 'user' ? ctx.actor.userId : null;

  return withTransaction(ctx, async (tx) => {
    const now = tx.clock.now();
    const [row] = await tx.db
      .update(researchItems)
      .set({
        status: nextStatus,
        evidenceLevel: nextEvidence,
        ...(data.topic !== undefined && { topic: data.topic }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.summary !== undefined && { summary: data.summary || null }),
        ...(becameVerified &&
          sidusAutoSync && { sidusSyncStatus: 'pending', sidusSyncError: null }),
        reviewedByUserId: reviewerId,
        reviewedAt: now,
        updatedAt: now,
      })
      // Optimistic guard: a concurrent review must not be applied on top of this one.
      .where(and(eq(researchItems.id, item.id), eq(researchItems.status, item.status)))
      .returning();
    if (!row) throw new ConflictError(CONCURRENT_CHANGE_MESSAGE);
    const updated = row;
    const submitterMemberId = await memberIdForUser(tx, item.submittedByUserId);
    await recordAudit(tx, {
      action: 'research.reviewed',
      targetType: 'research_item',
      targetId: item.id,
      context: {
        from: item.status,
        to: nextStatus,
        evidenceLevel: nextEvidence,
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
        payload: { evidenceLevel: nextEvidence, doi: updated.doi, arxivId: updated.arxivId },
      });
      if (sidusAutoSync) await enqueueSidusSync(tx, item.id);
    }
    if (nextStatus !== item.status && (nextStatus === 'reviewed' || nextStatus === 'verified')) {
      await notify(tx, {
        recipientUserId: item.submittedByUserId,
        type: 'research.reviewed',
        title: `RESEARCH ${STATUS_LABELS[nextStatus]}`,
        body: `${truncate(updated.title, TITLE_IN_NOTIFICATION)} — evidence: ${EVIDENCE_LABELS[nextEvidence] ?? 'UNKNOWN'}.`,
        data: { itemId: item.id, status: nextStatus, evidenceLevel: nextEvidence },
        dedupeKey: `research:${item.id}:status:${nextStatus}:${now.getTime()}`,
      });
    }
    return toView(updated);
  });
}

/** Queue (or re-queue) the Sidus push for a verified item. */
export async function requestSidusSync(
  ctx: ServiceContext,
  input: { itemId: string },
): Promise<ResearchItemView> {
  const { itemId } = parseInput(itemIdSchema, input);
  await authorize(ctx, 'canReviewResearch', { type: 'research_item', id: itemId });
  const item = await loadItem(ctx, itemId);
  if (item.status !== 'verified') {
    throw new InvalidStateError('Only VERIFIED items sync to Sidus.');
  }
  return withTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .update(researchItems)
      .set({ sidusSyncStatus: 'pending', sidusSyncError: null, updatedAt: tx.clock.now() })
      .where(eq(researchItems.id, item.id))
      .returning();
    await recordAudit(tx, {
      action: 'research.sidus_sync_requested',
      targetType: 'research_item',
      targetId: item.id,
    });
    await enqueueSidusSync(tx, item.id);
    return toView(row!);
  });
}
