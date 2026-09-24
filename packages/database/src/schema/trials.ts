import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { members, rankHistory, rankTiers, users } from './identity';

export const trialCategory = pgEnum('trial_category', [
  'build',
  'research',
  'strategy',
  'investigation',
  'crisis',
  'creation',
  'communication',
  'leadership',
  'marketing',
  'technical',
  'security',
  'adaptability',
  'teamwork',
  'execution',
]);

export const trialStatus = pgEnum('trial_status', [
  'draft',
  'recruiting',
  'teams_assigned',
  'active',
  'evaluating',
  'completed',
  'cancelled',
]);

/** A scoring rubric criterion. Weights are relative; they need not sum to 1. */
export interface RubricCriterion {
  key: string;
  label: string;
  description: string;
  weight: number;
}

export const trialTemplates = pgTable(
  'trial_templates',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    category: trialCategory('category').notNull(),
    summary: varchar('summary', { length: 280 }).notNull(),
    brief: text('brief').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    teamSizeMin: smallint('team_size_min').notNull().default(2),
    teamSizeMax: smallint('team_size_max').notNull().default(4),
    rubric: jsonb('rubric').$type<RubricCriterion[]>().notNull(),
    facetKeys: text('facet_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowsAdversarial: boolean('allows_adversarial').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('trial_templates_key_uq').on(t.key)],
);

export const trials = pgTable(
  'trials',
  {
    id: id(),
    number: integer('number').notNull().generatedAlwaysAsIdentity(),
    templateId: uuid('template_id').references(() => trialTemplates.id),
    title: varchar('title', { length: 120 }).notNull(),
    category: trialCategory('category').notNull(),
    brief: text('brief').notNull(),
    rubric: jsonb('rubric').$type<RubricCriterion[]>().notNull(),
    facetKeys: text('facet_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: trialStatus('status').notNull().default('draft'),
    teamSize: smallint('team_size').notNull().default(3),
    maxParticipants: integer('max_participants'),
    recruitmentClosesAt: ts('recruitment_closes_at'),
    scheduledStartAt: ts('scheduled_start_at'),
    durationMinutes: integer('duration_minutes').notNull(),
    /** Set when the trial starts: started_at + duration. */
    deadlineAt: ts('deadline_at'),
    startedAt: ts('started_at'),
    submissionsClosedAt: ts('submissions_closed_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    /** Hidden from participants. See adversarial.ts. */
    adversarialEnabled: boolean('adversarial_enabled').notNull().default(false),
    discordCategoryId: snowflake('discord_category_id'),
    announcementChannelId: snowflake('announcement_channel_id'),
    announcementMessageId: snowflake('announcement_message_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('trials_number_uq').on(t.number), index('trials_status_idx').on(t.status)],
);

export const trialTeams = pgTable(
  'trial_teams',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    ordinal: smallint('ordinal').notNull(),
    discordChannelId: snowflake('discord_channel_id'),
    discordRoleId: snowflake('discord_role_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('trial_teams_name_uq').on(t.trialId, t.name)],
);

export const trialParticipantStatus = pgEnum('trial_participant_status', [
  'applied',
  'selected',
  'waitlisted',
  'withdrawn',
  'removed',
]);
export const trialTeamRole = pgEnum('trial_team_role', ['lead', 'member']);

export const trialParticipants = pgTable(
  'trial_participants',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    status: trialParticipantStatus('status').notNull().default('applied'),
    teamId: uuid('team_id').references(() => trialTeams.id, { onDelete: 'set null' }),
    teamRole: trialTeamRole('team_role'),
    statement: text('statement'),
    appliedAt: ts('applied_at').notNull().defaultNow(),
    selectedAt: ts('selected_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trial_participants_member_uq').on(t.trialId, t.memberId),
    index('trial_participants_team_idx').on(t.teamId),
  ],
);

export const trialSubmissions = pgTable(
  'trial_submissions',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => trialTeams.id, { onDelete: 'cascade' }),
    submittedByMemberId: uuid('submitted_by_member_id')
      .notNull()
      .references(() => members.id),
    summary: text('summary').notNull(),
    links: text('links')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Resubmissions increment the version; the latest version is evaluated. */
    version: smallint('version').notNull().default(1),
    isLate: boolean('is_late').notNull().default(false),
    submittedAt: ts('submitted_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('trial_submissions_version_uq').on(t.teamId, t.version)],
);

/** An evaluator's assessment of a team (member_id null) or individual. */
export const trialEvaluations = pgTable(
  'trial_evaluations',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').references(() => trialTeams.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').references(() => members.id),
    evaluatorUserId: uuid('evaluator_user_id')
      .notNull()
      .references(() => users.id),
    /** Weighted score, 0–10, computed from trial_scores. */
    overallScore: doublePrecision('overall_score').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trial_evaluations_team_uq')
      .on(t.trialId, t.teamId, t.evaluatorUserId)
      .where(sql`${t.memberId} is null`),
    uniqueIndex('trial_evaluations_member_uq')
      .on(t.trialId, t.memberId, t.evaluatorUserId)
      .where(sql`${t.memberId} is not null`),
  ],
);

export const trialScores = pgTable(
  'trial_scores',
  {
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => trialEvaluations.id, { onDelete: 'cascade' }),
    criterionKey: varchar('criterion_key', { length: 48 }).notNull(),
    /** 0–10 */
    score: smallint('score').notNull(),
  },
  (t) => [primaryKey({ columns: [t.evaluationId, t.criterionKey] })],
);

export const trialOutcome = pgEnum('trial_outcome', ['distinction', 'pass', 'fail', 'incomplete']);

export const trialResults = pgTable(
  'trial_results',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    teamId: uuid('team_id').references(() => trialTeams.id, { onDelete: 'set null' }),
    teamScore: doublePrecision('team_score'),
    individualScore: doublePrecision('individual_score'),
    finalScore: doublePrecision('final_score'),
    outcome: trialOutcome('outcome').notNull(),
    /** Suggested rank consequence for the trial's primary facet. Applied explicitly. */
    facetKey: varchar('facet_key', { length: 48 }),
    recommendedRank: varchar('recommended_rank', { length: 4 }).references(() => rankTiers.code),
    rankHistoryId: uuid('rank_history_id').references(() => rankHistory.id),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('trial_results_member_uq').on(t.trialId, t.memberId)],
);
