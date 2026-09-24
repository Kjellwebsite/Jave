import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { capabilityFacets, evidence, members, rankTiers, users } from './identity';

export const verificationType = pgEnum('verification_type', [
  'identity',
  'project',
  'skill',
  'trial',
  'contribution',
  'achievement',
]);

export const verificationStatus = pgEnum('verification_status', [
  'pending',
  'in_review',
  'approved',
  'rejected',
  'revoked',
  'expired',
]);

/**
 * What an approval changed, recorded so a revocation reverses exactly that
 * (and nothing a later decision changed). Validated with zod in @jave/core.
 */
export type VerificationOutcome =
  | {
      kind: 'role';
      /** False when the subject already held VERIFIED (or a staff role) at approval time. */
      granted: boolean;
      /** Progression role held before VERIFIED was granted; restored on revocation. */
      previousRole: string | null;
    }
  | {
      kind: 'rank';
      facetKey: string;
      previousRank: string | null;
      grantedRank: string;
      /** Null when the verified rank already equalled the granted rank. */
      rankHistoryId: string | null;
    }
  | { kind: 'evidence'; evidenceId: string }
  | { kind: 'contribution'; contributionId: string }
  | { kind: 'achievement'; memberAchievementId: string };

/**
 * Generic verification record: WHAT (claim + target), WHO (subject),
 * WHEN (requested/decided/expires), EVIDENCE (linked rows), STATUS, VERIFIER.
 */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    type: verificationType('type').notNull(),
    subjectMemberId: uuid('subject_member_id')
      .notNull()
      .references(() => members.id),
    claim: text('claim').notNull(),
    /** Polymorphic target, e.g. ('project', <project id>). Validated in the service layer. */
    targetType: varchar('target_type', { length: 32 }),
    targetId: uuid('target_id'),
    /**
     * Normalized identity of what is verified (e.g. `project:<id>:<member>`).
     * At most one open (pending / in_review) verification per key.
     */
    targetKey: varchar('target_key', { length: 160 }).notNull(),
    /** Human-readable snapshot of the target at request time (e.g. the project title). */
    targetLabel: varchar('target_label', { length: 200 }).notNull(),
    /** For skill verification: the capability facet and requested rank. */
    facetKey: varchar('facet_key', { length: 48 }).references(() => capabilityFacets.key),
    requestedRank: varchar('requested_rank', { length: 4 }).references(() => rankTiers.code),
    grantedRank: varchar('granted_rank', { length: 4 }).references(() => rankTiers.code),
    status: verificationStatus('status').notNull().default('pending'),
    /** Null when opened by a system or integration actor. */
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
    assignedVerifierUserId: uuid('assigned_verifier_user_id').references(() => users.id),
    verifierUserId: uuid('verifier_user_id').references(() => users.id),
    decisionNote: text('decision_note'),
    outcome: jsonb('outcome').$type<VerificationOutcome>(),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    reviewStartedAt: ts('review_started_at'),
    decidedAt: ts('decided_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    revokeReason: text('revoke_reason'),
    /** Staff queue card posted by the bot (discord.verification.queue_card). */
    queueChannelId: snowflake('queue_channel_id'),
    queueMessageId: snowflake('queue_message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('verifications_number_uq').on(t.number),
    uniqueIndex('verifications_open_target_uq')
      .on(t.targetKey)
      .where(sql`${t.status} in ('pending', 'in_review')`),
    index('verifications_subject_idx').on(t.subjectMemberId),
    index('verifications_status_idx').on(t.status, t.requestedAt),
    index('verifications_expiry_idx').on(t.status, t.expiresAt),
    index('verifications_target_idx').on(t.targetType, t.targetId),
  ],
);

export const verificationEvidence = pgTable(
  'verification_evidence',
  {
    verificationId: uuid('verification_id')
      .notNull()
      .references(() => verifications.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id')
      .notNull()
      .references(() => evidence.id),
  },
  (t) => [
    primaryKey({ columns: [t.verificationId, t.evidenceId] }),
    index('verification_evidence_evidence_idx').on(t.evidenceId),
  ],
);
