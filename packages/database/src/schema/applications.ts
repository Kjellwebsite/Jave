import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { capabilityDomains, users } from './identity';

export const applicationStatus = pgEnum('application_status', [
  'draft',
  'submitted',
  'review',
  'interview',
  'accepted',
  'rejected',
  'withdrawn',
]);

export const applications = pgTable(
  'applications',
  {
    id: id(),
    /** Human-facing sequential number (APP-0042). */
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: applicationStatus('status').notNull().default('draft'),
    domainKey: varchar('domain_key', { length: 32 }).references(() => capabilityDomains.key),
    experience: text('experience'),
    projects: text('projects'),
    portfolioUrl: text('portfolio_url'),
    motivation: text('motivation'),
    /** Optional references. Private: visible to reviewers only. */
    references: text('references'),
    evidenceLinks: text('evidence_links')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    referralCode: varchar('referral_code', { length: 32 }),
    assignedReviewerUserId: uuid('assigned_reviewer_user_id').references(() => users.id),
    interviewAt: ts('interview_at'),
    submittedAt: ts('submitted_at'),
    decidedAt: ts('decided_at'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id),
    /** Internal decision rationale. Never shown to the applicant. */
    decisionReason: text('decision_reason'),
    /** Message shared with the applicant on decision. */
    applicantMessage: text('applicant_message'),
    /** When the current reviewer was assigned (claim or reassignment). */
    reviewAssignedAt: ts('review_assigned_at'),
    /**
     * Set once reviewers were reminded about the current wait: an unclaimed
     * submission, then an assignment with no recommendation. Cleared on every
     * (re)assignment, so each assignment is reminded at most once.
     */
    reviewReminderSentAt: ts('review_reminder_sent_at'),
    /**
     * Staff review card in the applicationsReview channel. `reviewCardRevision`
     * increases on every change the card shows; the bot records the revision it
     * rendered so stale renders never overwrite newer ones.
     */
    reviewChannelId: snowflake('review_channel_id'),
    reviewMessageId: snowflake('review_message_id'),
    reviewCardRevision: integer('review_card_revision').notNull().default(0),
    reviewCardRenderedRevision: integer('review_card_rendered_revision').notNull().default(0),
    /**
     * Render lease: at most one card render is in flight per application, so
     * Discord applies edits in the order JAVE issues them.
     */
    reviewCardLeaseId: varchar('review_card_lease_id', { length: 64 }),
    reviewCardLeaseExpiresAt: ts('review_card_lease_expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_number_uq').on(t.number),
    index('applications_user_idx').on(t.userId, t.createdAt),
    // One open application per person at a time.
    uniqueIndex('applications_open_per_user_uq')
      .on(t.userId)
      .where(sql`${t.status} in ('draft', 'submitted', 'review', 'interview')`),
    index('applications_status_idx').on(t.status, t.submittedAt),
  ],
);

export const applicationRecommendation = pgEnum('application_recommendation', [
  'accept',
  'reject',
  'interview',
  'abstain',
]);

export const applicationReviews = pgTable(
  'application_reviews',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    reviewerUserId: uuid('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    recommendation: applicationRecommendation('recommendation').notNull(),
    /** 1–5 overall assessment. */
    score: smallint('score'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('application_reviews_reviewer_uq').on(t.applicationId, t.reviewerUserId)],
);

/** Audit trail of every application state transition. */
export const applicationStatusChanges = pgTable(
  'application_status_changes',
  {
    id: id(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    fromStatus: applicationStatus('from_status'),
    toStatus: applicationStatus('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    note: text('note'),
    createdAt: createdAt(),
    /** Insertion order; breaks ties between changes recorded at the same instant. */
    sequence: integer('sequence').notNull().generatedAlwaysAsIdentity(),
  },
  (t) => [index('application_status_changes_app_idx').on(t.applicationId, t.createdAt)],
);
