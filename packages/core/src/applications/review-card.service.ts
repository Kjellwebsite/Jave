import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { applications } from '@jave/database';
import { loadCatalog } from '../identity/ranks';
import { enqueueJob } from '../jobs/queue';
import { MINUTE } from '../kernel/clock';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ConflictError, ForbiddenError, ValidationError } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { APPLICATION_REVIEW_CARD_JOB } from './discord-jobs';
import { assertNotOwnApplication } from './guards';
import { reviewCardKey, reviewCardRepairKey } from './keys';
import {
  type ApplicationRecord,
  applicationNumber,
  KEEP_UPDATED_AT,
  loadPeople,
  loadReviews,
  loadSubmittedApplication,
  type PersonRef,
} from './repository';
import { type ReviewTally, tallyReviews } from './rules';
import {
  applicationRefSchema,
  beginReviewCardRenderSchema,
  releaseReviewCardRenderSchema,
  reviewCardMessageSchema,
} from './schemas';
import { type ApplicationStatus, reviewCardActions, type StaffAction } from './state-machine';

/**
 * Data behind the Discord review card, and the bot's render protocol. See
 * discord-jobs.ts for the full contract.
 *
 * Renders of one card are serialized by a lease on the application row:
 * Discord applies concurrent edits of one message in no guaranteed order, so
 * only one render may be between `beginReviewCardRender` and
 * `recordReviewCardMessage` at a time. A render that outlives its lease is
 * followed by a repair render, so the card still converges on the newest
 * revision.
 */

/** Answer excerpts on the card stay short; the full text lives in the staff view. */
export const REVIEW_CARD_EXCERPT_CHARS = 300;

/** How long one render may hold the card before another may take over. */
export const REVIEW_CARD_RENDER_LEASE_MS = MINUTE;

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface ReviewCard {
  applicationId: string;
  number: string;
  status: ApplicationStatus;
  /** Revision of the state this card shows. */
  revision: number;
  /** Configured applicationsReview channel, where new cards are posted. */
  channelId: string | null;
  /** The card already posted, if any. */
  message: MessageRef | null;
  applicant: PersonRef | null;
  domain: { key: string; label: string } | null;
  submittedAt: Date | null;
  interviewAt: Date | null;
  decidedAt: Date | null;
  assignedReviewer: PersonRef | null;
  tally: ReviewTally;
  /** Enough counted reviews for a decision under current settings. */
  decisionReady: boolean;
  motivationExcerpt: string | null;
  projectsExcerpt: string | null;
  portfolioUrl: string | null;
  evidenceLinkCount: number;
  referred: boolean;
  /**
   * Buttons to render. Accept/reject appear only once a decision is possible.
   * Each button's handler re-authorizes the clicking user.
   */
  actions: readonly StaffAction[];
}

/**
 * Card data. Excludes private references and the internal decision reason —
 * a channel message is wider than a capability check.
 */
async function buildReviewCard(ctx: ServiceContext, app: ApplicationRecord): Promise<ReviewCard> {
  const settings = await getSettings(ctx, 'applications');
  const channels = await getSettings(ctx, 'channels');
  const catalog = await loadCatalog(ctx);
  const tally = tallyReviews(await loadReviews(ctx, app.id));
  const people = await loadPeople(ctx, [app.userId, app.assignedReviewerUserId]);
  const domain = catalog.domains.find((entry) => entry.key === app.domainKey);
  const decisionReady = tally.counted >= settings.minReviewsBeforeDecision;
  return {
    applicationId: app.id,
    number: applicationNumber(app),
    status: app.status,
    revision: app.reviewCardRevision,
    channelId: channels.applicationsReview ?? null,
    message: storedMessage(app),
    applicant: people.get(app.userId) ?? null,
    domain: domain ? { key: domain.key, label: domain.label } : null,
    submittedAt: app.submittedAt,
    interviewAt: app.interviewAt,
    decidedAt: app.decidedAt,
    assignedReviewer: app.assignedReviewerUserId
      ? (people.get(app.assignedReviewerUserId) ?? null)
      : null,
    tally,
    decisionReady,
    motivationExcerpt: app.motivation ? truncate(app.motivation, REVIEW_CARD_EXCERPT_CHARS) : null,
    projectsExcerpt: app.projects ? truncate(app.projects, REVIEW_CARD_EXCERPT_CHARS) : null,
    portfolioUrl: app.portfolioUrl,
    evidenceLinkCount: app.evidenceLinks.length,
    referred: Boolean(app.referralCode),
    actions: reviewCardActions(app.status, decisionReady),
  };
}

function storedMessage(app: ApplicationRecord): MessageRef | null {
  return app.reviewChannelId && app.reviewMessageId
    ? { channelId: app.reviewChannelId, messageId: app.reviewMessageId }
    : null;
}

/** Card data for staff surfaces (dashboard). Not part of the render protocol. */
export async function getReviewCard(
  ctx: ServiceContext,
  input: z.input<typeof applicationRefSchema>,
): Promise<ReviewCard> {
  const { applicationId } = parseInput(applicationRefSchema, input);
  await authorize(ctx, 'canViewApplications', { type: 'application', id: applicationId });
  const app = await loadSubmittedApplication(ctx, applicationId);
  await assertNotOwnApplication(ctx, app, 'review_card');
  return buildReviewCard(ctx, app);
}

function requireWorker(ctx: ServiceContext): void {
  if (ctx.actor.kind !== 'system') {
    throw new ForbiddenError('Only the JAVE worker renders review cards.');
  }
}

function assertRevisionExists(app: ApplicationRecord, revision: number): void {
  if (revision > app.reviewCardRevision) {
    throw new ValidationError('That card revision does not exist yet.', [
      { path: 'revision', message: 'ahead of the application' },
    ]);
  }
}

export type ReviewCardRenderStart =
  | { outcome: 'render'; card: ReviewCard }
  | { outcome: 'superseded'; currentRevision: number }
  | { outcome: 'no_channel' };

/**
 * Step 1 of a render. Returns `superseded` when a newer revision exists (its
 * own job renders it), and `no_channel` when there is no card to edit and no
 * review channel to post in. Otherwise takes the render lease for `renderId`
 * and returns the card to render. Throws ConflictError — retryable, so the
 * job backs off and tries again — while another render holds a live lease.
 * System actor only.
 */
export async function beginReviewCardRender(
  ctx: ServiceContext,
  input: z.input<typeof beginReviewCardRenderSchema>,
): Promise<ReviewCardRenderStart> {
  requireWorker(ctx);
  const data = parseInput(beginReviewCardRenderSchema, input);
  return withTransaction(ctx, async (tx) => {
    const app = await loadSubmittedApplication(tx, data.applicationId, { forUpdate: true });
    assertRevisionExists(app, data.revision);
    if (data.revision < app.reviewCardRevision) {
      return { outcome: 'superseded', currentRevision: app.reviewCardRevision };
    }
    const channels = await getSettings(tx, 'channels');
    if (!storedMessage(app) && !channels.applicationsReview) return { outcome: 'no_channel' };
    const now = tx.clock.now();
    const leaseLive =
      app.reviewCardLeaseExpiresAt !== null &&
      app.reviewCardLeaseExpiresAt.getTime() > now.getTime();
    if (app.reviewCardLeaseId !== null && app.reviewCardLeaseId !== data.renderId && leaseLive) {
      throw new ConflictError('Another render of this review card is in progress.', {
        retryAfter: app.reviewCardLeaseExpiresAt?.toISOString(),
      });
    }
    await tx.db
      .update(applications)
      .set({
        reviewCardLeaseId: data.renderId,
        reviewCardLeaseExpiresAt: new Date(now.getTime() + REVIEW_CARD_RENDER_LEASE_MS),
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(eq(applications.id, app.id));
    return { outcome: 'render', card: await buildReviewCard(tx, app) };
  });
}

export interface ReviewCardRecordResult {
  /** A duplicate card the bot must delete, or null. */
  discard: MessageRef | null;
}

/**
 * Step 2 of a render: the bot posted or edited the card. Stores the message,
 * releases the lease, and makes sure the card catches up:
 *
 * - the lease holder rendered an older revision than the current one → the
 *   current revision's job is (re)enqueued (a no-op when it is still live);
 * - the render had lost its lease (it outlived REVIEW_CARD_RENDER_LEASE_MS
 *   and another render took over) → its edit may have landed after the other
 *   render's, so a repair render of the current revision is enqueued under a
 *   key of its own.
 *
 * When two renders posted two messages, the lease holder's (else the newer
 * revision's) is kept and the other is returned in `discard`. System actor
 * only.
 */
export async function recordReviewCardMessage(
  ctx: ServiceContext,
  input: z.input<typeof reviewCardMessageSchema>,
): Promise<ReviewCardRecordResult> {
  requireWorker(ctx);
  const data = parseInput(reviewCardMessageSchema, input);
  return withTransaction(ctx, async (tx) => {
    const app = await loadSubmittedApplication(tx, data.applicationId, { forUpdate: true });
    assertRevisionExists(app, data.revision);
    const holdsLease = app.reviewCardLeaseId === data.renderId;
    const posted: MessageRef = { channelId: data.channelId, messageId: data.messageId };
    const stored = storedMessage(app);
    const sameMessage =
      stored !== null &&
      stored.messageId === posted.messageId &&
      stored.channelId === posted.channelId;
    const keepPosted =
      !stored || sameMessage || holdsLease || data.revision >= app.reviewCardRenderedRevision;
    await tx.db
      .update(applications)
      .set({
        ...(keepPosted
          ? {
              reviewChannelId: posted.channelId,
              reviewMessageId: posted.messageId,
              // Serialized renders land in order, so the holder's revision is
              // what the card shows. Without the lease, only raise it.
              reviewCardRenderedRevision: holdsLease
                ? data.revision
                : sql`greatest(${applications.reviewCardRenderedRevision}, ${data.revision})`,
            }
          : {}),
        ...(holdsLease ? { reviewCardLeaseId: null, reviewCardLeaseExpiresAt: null } : {}),
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(eq(applications.id, app.id));

    const current = app.reviewCardRevision;
    const payload = { applicationId: app.id, revision: current };
    if (!holdsLease) {
      await enqueueJob(tx, APPLICATION_REVIEW_CARD_JOB, payload, {
        dedupeKey: reviewCardRepairKey(app.id, current, data.renderId),
      });
    } else if (data.revision < current) {
      await enqueueJob(tx, APPLICATION_REVIEW_CARD_JOB, payload, {
        dedupeKey: reviewCardKey(app.id, current),
      });
    }

    if (!stored || sameMessage) return { discard: null };
    return { discard: keepPosted ? stored : posted };
  });
}

/**
 * Give the lease back after a failed render (best effort; an unreleased lease
 * expires after REVIEW_CARD_RENDER_LEASE_MS). If the card is behind, the
 * current revision's job is (re)enqueued. System actor only.
 */
export async function releaseReviewCardRender(
  ctx: ServiceContext,
  input: z.input<typeof releaseReviewCardRenderSchema>,
): Promise<{ released: boolean }> {
  requireWorker(ctx);
  const data = parseInput(releaseReviewCardRenderSchema, input);
  return withTransaction(ctx, async (tx) => {
    const app = await loadSubmittedApplication(tx, data.applicationId, { forUpdate: true });
    if (app.reviewCardLeaseId !== data.renderId) return { released: false };
    await tx.db
      .update(applications)
      .set({
        reviewCardLeaseId: null,
        reviewCardLeaseExpiresAt: null,
        updatedAt: KEEP_UPDATED_AT,
      })
      .where(eq(applications.id, app.id));
    if (app.reviewCardRenderedRevision < app.reviewCardRevision) {
      await enqueueJob(
        tx,
        APPLICATION_REVIEW_CARD_JOB,
        { applicationId: app.id, revision: app.reviewCardRevision },
        { dedupeKey: reviewCardKey(app.id, app.reviewCardRevision) },
      );
    }
    return { released: true };
  });
}
