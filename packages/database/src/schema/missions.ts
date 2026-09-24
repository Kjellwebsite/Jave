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
import { createdAt, id, ts, updatedAt } from './_shared';
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
    /** Per-assignment time limit, applied from acceptance. */
    durationHours: integer('duration_hours'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
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
    evidenceId: uuid('evidence_id').references(() => evidence.id),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
    verifiedAt: ts('verified_at'),
    feedback: text('feedback'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mission_assignments_member_uq').on(t.missionId, t.memberId),
    index('mission_assignments_member_idx').on(t.memberId, t.status),
    index('mission_assignments_due_idx').on(t.status, t.dueAt),
  ],
);
