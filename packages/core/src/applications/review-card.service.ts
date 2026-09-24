import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { applications } from '@jave/database';
import { loadCatalog } from '../identity/ranks';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import { truncate } from '../kernel/redact';
import { parseInput } from '../kernel/validation';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { assertNotOwnApplication } from './guards';
import {
  applicationNumber,
  KEEP_UPDATED_AT,
  loadPeople,
  loadReviews,
  loadSubmittedApplication,
  type PersonRef,
} from './repository';
import { type ReviewTally, tallyReviews } from './rules';
import { applicationRefSchema, reviewCardMessageSchema } from './schemas';
import { type ApplicationStatus, type StaffAction, staffActionsFor } from './state-machine';

/**
 * Data behind the Discord review card, and the bot's callback. See
 * discord-jobs.ts for the full contract.
 */

/** Answer excerpts on the card stay short; the full text lives in the staff view. */
export const REVIEW_CARD_EXCERPT_CHARS = 300;

export interface MessageRef {
  channelId: string;
  messageId: string;
}

export interface ReviewCard {
  applicationId: string;
  number: string;
  status: ApplicationStatus;
  /** Current revision; the bot skips jobs carrying an older one. */
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
  /** Buttons to render. Each button's handler re-authorizes the clicking user. */
  actions: readonly StaffAction[];
}

/**
 * Card data for the staff review channel. Excludes private references and
 * the internal decision reason — a channel message is wider than a
 * capability check.
 */
export async function getReviewCard(
  ctx: ServiceContext,
  input: z.input<typeof applicationRefSchema>,
): Promise<ReviewCard> {
  const { applicationId } = parseInput(applicationRefSchema, input);
  await authorize(ctx, 'canViewApplications', { type: 'application', id: applicationId });
  const app = await loadSubmittedApplication(ctx, applicationId);
  await assertNotOwnApplication(ctx, app, 'review_card');
  const settings = await getSettings(ctx, 'applications');
  const channels = await getSettings(ctx, 'channels');
  const catalog = await loadCatalog(ctx);
  const tally = tallyReviews(await loadReviews(ctx, app.id));
  const people = await loadPeople(ctx, [app.userId, app.assignedReviewerUserId]);
  const domain = catalog.domains.find((entry) => entry.key === app.domainKey);
  return {
    applicationId: app.id,
    number: applicationNumber(app),
    status: app.status,
    revision: app.reviewCardRevision,
    channelId: channels.applicationsReview ?? null,
    message:
      app.reviewChannelId && app.reviewMessageId
        ? { channelId: app.reviewChannelId, messageId: app.reviewMessageId }
        : null,
    applicant: people.get(app.userId) ?? null,
    domain: domain ? { key: domain.key, label: domain.label } : null,
    submittedAt: app.submittedAt,
    interviewAt: app.interviewAt,
    decidedAt: app.decidedAt,
    assignedReviewer: app.assignedReviewerUserId
      ? (people.get(app.assignedReviewerUserId) ?? null)
      : null,
    tally,
    decisionReady: tally.counted >= settings.minReviewsBeforeDecision,
    motivationExcerpt: app.motivation ? truncate(app.motivation, REVIEW_CARD_EXCERPT_CHARS) : null,
    projectsExcerpt: app.projects ? truncate(app.projects, REVIEW_CARD_EXCERPT_CHARS) : null,
    portfolioUrl: app.portfolioUrl,
    evidenceLinkCount: app.evidenceLinks.length,
    referred: Boolean(app.referralCode),
    actions: staffActionsFor(app.status),
  };
}

export interface ReviewCardRecordResult {
  /** A duplicate card the bot must delete, or null. */
  discard: MessageRef | null;
}

/**
 * Bot callback after posting or editing a review card. When two renders
 * raced and posted two messages, the one carrying the newer revision is kept
 * and the other is returned in `discard`. System actor only: the worker is
 * the only caller.
 */
export async function recordReviewCardMessage(
  ctx: ServiceContext,
  input: z.input<typeof reviewCardMessageSchema>,
): Promise<ReviewCardRecordResult> {
  if (ctx.actor.kind !== 'system') {
    throw new ForbiddenError('Only the JAVE worker records review cards.');
  }
  const data = parseInput(reviewCardMessageSchema, input);
  return withTransaction(ctx, async (tx) => {
    const app = await loadSubmittedApplication(tx, data.applicationId, { forUpdate: true });
    if (data.revision > app.reviewCardRevision) {
      throw new ValidationError('That card revision does not exist yet.', [
        { path: 'revision', message: 'ahead of the application' },
      ]);
    }
    const posted: MessageRef = { channelId: data.channelId, messageId: data.messageId };
    const stored: MessageRef | null =
      app.reviewChannelId && app.reviewMessageId
        ? { channelId: app.reviewChannelId, messageId: app.reviewMessageId }
        : null;
    const sameMessage =
      stored !== null &&
      stored.messageId === posted.messageId &&
      stored.channelId === posted.channelId;
    const keepPosted = !stored || sameMessage || data.revision >= app.reviewCardRenderedRevision;
    if (keepPosted) {
      await tx.db
        .update(applications)
        .set({
          reviewChannelId: posted.channelId,
          reviewMessageId: posted.messageId,
          reviewCardRenderedRevision: sql`greatest(${applications.reviewCardRenderedRevision}, ${data.revision})`,
          updatedAt: KEEP_UPDATED_AT,
        })
        .where(eq(applications.id, app.id));
    }
    if (!stored || sameMessage) return { discard: null };
    return { discard: keepPosted ? stored : posted };
  });
}
