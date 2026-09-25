import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, snowflake, ts, updatedAt } from './_shared';
import { members, users } from './identity';
import { trialTeams, trials } from './trials';

/**
 * SAFE adversarial evaluation framework.
 *
 * Every table here is staff-only. Scenarios operate exclusively inside
 * authorized JAVELIN trial environments using fictional data and sandbox
 * accounts. They measure security culture — never real credentials, real
 * private data, real people outside the trial, or external systems.
 */

export const adversarialTechnique = pgEnum('adversarial_technique', [
  'social_engineering',
  'instruction_integrity',
  'permission_hygiene',
  'data_handling',
  'verification_discipline',
]);

export const adversarialScenarios = pgTable(
  'adversarial_scenarios',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    technique: adversarialTechnique('technique').notNull(),
    description: text('description').notNull(),
    /** What the operative attempts, e.g. "request the (fictional) staging token in chat". */
    objective: text('objective').notNull(),
    /** Explicit prohibitions for the operative. Always shown in their briefing. */
    guardrails: text('guardrails').notNull(),
    /** Description of the fictional assets the scenario uses. */
    sandboxAssets: text('sandbox_assets').notNull(),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('adversarial_scenarios_key_uq').on(t.key)],
);

export const adversarialRoleStatus = pgEnum('adversarial_role_status', [
  'planned',
  'briefed',
  'active',
  'concluded',
  'revealed',
  'aborted',
]);

/** Outcome of a Discord side effect reported back by the bot. */
export const adversarialDelivery = pgEnum('adversarial_delivery', [
  'pending',
  'sent',
  'undeliverable',
]);

export const adversarialRoles = pgTable(
  'adversarial_roles',
  {
    id: id(),
    trialId: uuid('trial_id')
      .notNull()
      .references(() => trials.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').references(() => trialTeams.id, { onDelete: 'set null' }),
    operativeMemberId: uuid('operative_member_id')
      .notNull()
      .references(() => members.id),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => adversarialScenarios.id),
    objective: text('objective').notNull(),
    /**
     * Snapshot of the scenario guardrails and sandbox assets at planning time:
     * what the second person authorized is exactly what the operative is briefed on,
     * even if the scenario library changes later.
     */
    guardrails: text('guardrails').notNull(),
    sandboxAssets: text('sandbox_assets').notNull(),
    status: adversarialRoleStatus('status').notNull().default('planned'),
    /** Founder/Core authorization is mandatory before briefing. */
    authorizedByUserId: uuid('authorized_by_user_id').references(() => users.id),
    authorizedAt: ts('authorized_at'),
    /** Attestation: scenario uses only fictional data and sandbox accounts. */
    sandboxAttested: boolean('sandbox_attested').notNull().default(false),
    briefedAt: ts('briefed_at'),
    /** Increments whenever the briefing content changes after the first briefing. */
    briefingRevision: smallint('briefing_revision').notNull().default(1),
    briefingDelivery: adversarialDelivery('briefing_delivery'),
    briefingDeliveredAt: ts('briefing_delivered_at'),
    activatedAt: ts('activated_at'),
    concludedAt: ts('concluded_at'),
    revealedAt: ts('revealed_at'),
    abortedAt: ts('aborted_at'),
    abortReason: text('abort_reason'),
    abortedByUserId: uuid('aborted_by_user_id').references(() => users.id),
    /** Set when the stop word was invoked (by the operative or staff). */
    redFlagRaisedAt: ts('red_flag_raised_at'),
    redFlagRaisedByUserId: uuid('red_flag_raised_by_user_id').references(() => users.id),
    stopNoticeDelivery: adversarialDelivery('stop_notice_delivery'),
    stopNoticeDeliveredAt: ts('stop_notice_delivered_at'),
    debriefDelivery: adversarialDelivery('debrief_delivery'),
    debriefChannelId: snowflake('debrief_channel_id'),
    debriefMessageId: snowflake('debrief_message_id'),
    debriefPostedAt: ts('debrief_posted_at'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('adversarial_roles_trial_idx').on(t.trialId),
    index('adversarial_roles_operative_idx').on(t.operativeMemberId),
    /** One non-aborted role per operative per trial. */
    uniqueIndex('adversarial_roles_operative_uq')
      .on(t.trialId, t.operativeMemberId)
      .where(sql`${t.abortedAt} is null`),
    /** One non-aborted role per team: limits exposure and keeps debriefs unambiguous. */
    uniqueIndex('adversarial_roles_team_uq')
      .on(t.teamId)
      .where(sql`${t.abortedAt} is null`),
  ],
);

export const adversarialTriggers = pgTable(
  'adversarial_triggers',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adversarialRoles.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 120 }).notNull(),
    description: text('description').notNull(),
    plannedFor: ts('planned_for'),
    firedAt: ts('fired_at'),
    firedByUserId: uuid('fired_by_user_id').references(() => users.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('adversarial_triggers_role_idx').on(t.roleId)],
);

export const adversarialOutcome = pgEnum('adversarial_outcome', [
  'resisted',
  'detected',
  'reported',
  'partial',
  'failure',
]);

export const adversarialObservations = pgTable(
  'adversarial_observations',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adversarialRoles.id, { onDelete: 'cascade' }),
    triggerId: uuid('trigger_id').references(() => adversarialTriggers.id, {
      onDelete: 'set null',
    }),
    observerUserId: uuid('observer_user_id')
      .notNull()
      .references(() => users.id),
    subjectMemberId: uuid('subject_member_id').references(() => members.id),
    outcome: adversarialOutcome('outcome').notNull(),
    description: text('description').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('adversarial_observations_role_idx').on(t.roleId)],
);

export const adversarialEvaluations = pgTable(
  'adversarial_evaluations',
  {
    id: id(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => adversarialRoles.id, { onDelete: 'cascade' }),
    evaluatorUserId: uuid('evaluator_user_id')
      .notNull()
      .references(() => users.id),
    /** 0–10: how well the team's security culture held up. */
    securityCultureScore: smallint('security_culture_score').notNull(),
    /** Score derived from observations at evaluation time; null when there were none. */
    suggestedScore: smallint('suggested_score'),
    /** Required whenever the recorded score differs from the suggested score. */
    overrideJustification: text('override_justification'),
    summary: text('summary').notNull(),
    /** Shared with the team after the reveal. */
    debrief: text('debrief'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('adversarial_evaluations_role_uq').on(t.roleId),
    check('adversarial_evaluations_score_ck', sql`${t.securityCultureScore} between 0 and 10`),
    check(
      'adversarial_evaluations_suggested_ck',
      sql`${t.suggestedScore} is null or ${t.suggestedScore} between 0 and 10`,
    ),
  ],
);
