import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_shared';
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
 * Generic verification record: WHAT (claim + target), WHO (subject),
 * WHEN (requested/decided), EVIDENCE (linked rows), STATUS, VERIFIER.
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
    /** For skill verification: the capability facet and requested rank. */
    facetKey: varchar('facet_key', { length: 48 }).references(() => capabilityFacets.key),
    requestedRank: varchar('requested_rank', { length: 4 }).references(() => rankTiers.code),
    grantedRank: varchar('granted_rank', { length: 4 }).references(() => rankTiers.code),
    status: verificationStatus('status').notNull().default('pending'),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    assignedVerifierUserId: uuid('assigned_verifier_user_id').references(() => users.id),
    verifierUserId: uuid('verifier_user_id').references(() => users.id),
    decisionNote: text('decision_note'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('verifications_number_uq').on(t.number),
    index('verifications_subject_idx').on(t.subjectMemberId),
    index('verifications_status_idx').on(t.status, t.requestedAt),
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
  (t) => [primaryKey({ columns: [t.verificationId, t.evidenceId] })],
);
