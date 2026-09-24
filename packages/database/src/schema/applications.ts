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
import { createdAt, id, ts, updatedAt } from './_shared';
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('applications_number_uq').on(t.number),
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
  },
  (t) => [index('application_status_changes_app_idx').on(t.applicationId, t.createdAt)],
);
