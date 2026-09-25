import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { achievementDefinitions } from './achievements';
import { capabilityFacets, evidence, members, users } from './identity';

export const missionType = pgEnum('mission_type', [
  'individual',
  'team',
  'research',
  'build',
  'social',
  'physical',
  'strategy',
  'creative',
]);
export const missionStatus = pgEnum('mission_status', ['draft', 'open', 'closed', 'archived']);

export const missions = pgTable(
  'missions',
  {
    id: id(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    title: varchar('title', { length: 120 }).notNull(),
    brief: text('brief').notNull(),
    type: missionType('type').notNull(),
    status: missionStatus('status').notNull().default('draft'),
    /** Capability this mission produces evidence for. */
    facetKey: varchar('facet_key', { length: 48 }).references(() => capabilityFacets.key),
    evidenceRequired: boolean('evidence_required').notNull().default(true),
    rewardAchievementKey: varchar('reward_achievement_key', { length: 64 }).references(
      () => achievementDefinitions.key,
    ),
    rewardNote: varchar('reward_note', { length: 200 }),
    maxAssignees: integer('max_assignees'),
    selfAssignable: boolean('self_assignable').notNull().default(true),
    deadlineAt: ts('deadline_at'),
    /** Per-assignment time limit, counted from assignment and capped by deadline_at. */
    durationHours: integer('duration_hours'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: ts('published_at'),
    closedAt: ts('closed_at'),
    archivedAt: ts('archived_at'),
    /** Discord mission card (set by the bot through markMissionAnnounced). */
    announcementChannelId: snowflake('announcement_channel_id'),
    announcementMessageId: snowflake('announcement_message_id'),
  },
  (t) => [
    uniqueIndex('missions_number_uq').on(t.number),
    index('missions_status_idx').on(t.status),
  ],
);

export const missionAssignmentStatus = pgEnum('mission_assignment_status', [
  'assigned',
  'accepted',
  'submitted',
  'verified',
  'rejected',
  'expired',
  'abandoned',
]);

export const missionAssignments = pgTable(
  'mission_assignments',
  {
    id: id(),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    /** Team missions: assignments sharing a team key submit together. */
    teamKey: varchar('team_key', { length: 32 }),
    status: missionAssignmentStatus('status').notNull().default('assigned'),
    /** Null when self-assigned. */
    assignedByUserId: uuid('assigned_by_user_id').references(() => users.id),
    assignedAt: ts('assigned_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
    dueAt: ts('due_at'),
    submittedAt: ts('submitted_at'),
    submission: text('submission'),
    /** Evidence attached to the latest submission; becomes an evidence row on verification. */
    submissionEvidenceTitle: varchar('submission_evidence_title', { length: 200 }),
    submissionEvidenceUrl: text('submission_evidence_url'),
    /** Team missions: the teammate who sent the shared submission. */
    submittedByMemberId: uuid('submitted_by_member_id').references(() => members.id),
    /** Number of submissions sent (resubmissions after a rejection included). */
    attempts: integer('attempts').notNull().default(0),
    evidenceId: uuid('evidence_id').references(() => evidence.id),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: ts('verified_at'),
    /** Last review decision (verify or reject). */
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    feedback: text('feedback'),
    /** The due date a deadline reminder was sent for (reminders re-arm when due_at changes). */
    reminderDueAt: ts('reminder_due_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mission_assignments_member_uq').on(t.missionId, t.memberId),
    index('mission_assignments_member_idx').on(t.memberId, t.status),
    index('mission_assignments_due_idx').on(t.status, t.dueAt),
    index('mission_assignments_team_idx').on(t.missionId, t.teamKey),
  ],
);
