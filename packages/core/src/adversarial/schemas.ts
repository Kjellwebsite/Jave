import { z } from 'zod';
import { adversarialOutcome, adversarialRoleStatus, adversarialTechnique } from '@jave/database';
import { pageSchema } from '../kernel/pagination';
import { SCORE_MAX, SCORE_MIN } from './scoring';

/** Input length caps. Discord embeds cap descriptions at 4096 characters; debriefs stay well below. */
export const LIMITS = {
  scenarioKey: 64,
  title: 120,
  description: 2000,
  objective: 1000,
  guardrails: 4000,
  sandboxAssets: 1000,
  triggerLabel: 120,
  triggerDescription: 1000,
  observation: 2000,
  summary: 2000,
  debrief: 3000,
  justification: 1000,
  stopText: 500,
  stopTextInput: 2000,
  authorizationNote: 500,
} as const;

/** Minimum lengths: enough to be meaningful, never enough to force padding. */
export const MIN_LENGTHS = {
  label: 3,
  reason: 3,
  prose: 10,
  debrief: 20,
  /** The standard prohibitions alone are far longer; this only rejects stubs early. */
  guardrails: 50,
} as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const scenarioKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'use 3–64 lowercase letters, digits and dashes');

const technique = z.enum(adversarialTechnique.enumValues);

export const createScenarioSchema = z.object({
  key: scenarioKey,
  title: text(MIN_LENGTHS.label, LIMITS.title),
  technique,
  description: text(MIN_LENGTHS.prose, LIMITS.description),
  objective: text(MIN_LENGTHS.prose, LIMITS.objective),
  guardrails: text(MIN_LENGTHS.guardrails, LIMITS.guardrails),
  sandboxAssets: text(MIN_LENGTHS.prose, LIMITS.sandboxAssets),
});

export const updateScenarioSchema = z
  .object({
    scenarioId: z.uuid(),
    title: text(MIN_LENGTHS.label, LIMITS.title).optional(),
    technique: technique.optional(),
    description: text(MIN_LENGTHS.prose, LIMITS.description).optional(),
    objective: text(MIN_LENGTHS.prose, LIMITS.objective).optional(),
    guardrails: text(MIN_LENGTHS.guardrails, LIMITS.guardrails).optional(),
    sandboxAssets: text(MIN_LENGTHS.prose, LIMITS.sandboxAssets).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) => Object.entries(value).some(([key, v]) => key !== 'scenarioId' && v !== undefined),
    'Nothing to update.',
  );

export const scenarioIdSchema = z.object({ scenarioId: z.uuid() });

export const listScenariosSchema = pageSchema.extend({
  active: z.boolean().optional(),
  technique: technique.optional(),
});

export const planRoleSchema = z.object({
  trialId: z.uuid(),
  teamId: z.uuid(),
  operativeMemberId: z.uuid(),
  scenarioId: z.uuid(),
  /** Defaults to the scenario objective. */
  objective: text(MIN_LENGTHS.prose, LIMITS.objective).optional(),
});

export const roleIdSchema = z.object({ roleId: z.uuid() });

export const authorizeRoleSchema = z.object({
  roleId: z.uuid(),
  sandboxAttested: z.literal(true, {
    error: 'Attest that the scenario uses only fictional data and sandbox accounts.',
  }),
  note: z.string().trim().max(LIMITS.authorizationNote).optional(),
});

/**
 * STOP texts (abort reasons, RED FLAG notes) are cut, never rejected for
 * length: a STOP must always go through. Services sanitize and cap them again.
 */
const stopText = z.string().transform((value) => value.slice(0, LIMITS.stopTextInput));

export const abortRoleSchema = z.object({
  roleId: z.uuid(),
  reason: stopText.pipe(z.string().trim().min(MIN_LENGTHS.reason, 'Give a reason')),
});

export const raiseRedFlagSchema = z.object({
  roleId: z.uuid(),
  note: stopText.optional(),
});

export const addTriggerSchema = z.object({
  roleId: z.uuid(),
  label: text(MIN_LENGTHS.label, LIMITS.triggerLabel),
  description: text(MIN_LENGTHS.prose, LIMITS.triggerDescription),
  plannedFor: z.coerce.date().optional(),
});

export const fireTriggerSchema = z.object({
  roleId: z.uuid(),
  triggerId: z.uuid(),
});

export const recordObservationSchema = z.object({
  roleId: z.uuid(),
  outcome: z.enum(adversarialOutcome.enumValues),
  description: text(MIN_LENGTHS.prose, LIMITS.observation),
  subjectMemberId: z.uuid().optional(),
  triggerId: z.uuid().optional(),
  occurredAt: z.coerce.date().optional(),
});

export const evaluateRoleSchema = z.object({
  roleId: z.uuid(),
  /** Omit to accept the suggested score. */
  score: z.number().int().min(SCORE_MIN).max(SCORE_MAX).optional(),
  justification: text(MIN_LENGTHS.prose, LIMITS.justification).optional(),
  summary: text(MIN_LENGTHS.prose, LIMITS.summary),
  /** Shared with the team at the reveal. Required before revealing. */
  debrief: text(MIN_LENGTHS.debrief, LIMITS.debrief).optional(),
});

export const listRolesSchema = pageSchema.extend({
  trialId: z.uuid().optional(),
  status: z.enum(adversarialRoleStatus.enumValues).optional(),
});

// ─── Bot callbacks ───────────────────────────────────────────────────────────

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const deliveryOutcome = z.enum(['sent', 'undeliverable']);

export const loadBriefingSchema = z.object({
  roleId: z.uuid(),
  /** The revision the job was enqueued for (from its payload). */
  revision: z.number().int().min(1),
});

export const markBriefingDeliveredSchema = z.object({
  roleId: z.uuid(),
  revision: z.number().int().min(1),
  outcome: deliveryOutcome,
});

export const markStopNoticeDeliveredSchema = z.object({
  roleId: z.uuid(),
  outcome: deliveryOutcome,
});

export const markDebriefPostedSchema = z
  .object({
    roleId: z.uuid(),
    outcome: deliveryOutcome,
    channelId: snowflake.optional(),
    messageId: snowflake.optional(),
  })
  .refine(
    (value) => value.outcome !== 'sent' || (value.channelId && value.messageId),
    'A posted debrief needs its channel and message IDs.',
  );
