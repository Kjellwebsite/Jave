import { z } from 'zod';
import {
  ACHIEVEMENT_RARITIES,
  ACHIEVEMENT_VISIBILITIES,
  achievementCriteriaSchema,
} from './criteria';
import { multiLineText, singleLineText } from './guards';

export const ACHIEVEMENT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
export const ACHIEVEMENT_CATEGORY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
export const TITLE_MIN = 2;
export const TITLE_MAX = 64;
export const SUMMARY_MIN = 3;
export const SUMMARY_MAX = 120;
export const DESCRIPTION_MIN = 3;
export const DESCRIPTION_MAX = 1000;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const MAX_ORDINAL = 9999;
export const FACET_KEY_MAX = 48;

export const achievementKeySchema = z
  .string()
  .trim()
  .regex(ACHIEVEMENT_KEY_PATTERN, 'Key: 2–64 chars, a–z, 0–9 or _, starting with a letter');

const categorySchema = z
  .string()
  .trim()
  .regex(ACHIEVEMENT_CATEGORY_PATTERN, 'Category: 2–32 chars, a–z, 0–9 or _');

const definitionFields = {
  title: singleLineText(TITLE_MIN, TITLE_MAX),
  summary: singleLineText(SUMMARY_MIN, SUMMARY_MAX),
  description: multiLineText(DESCRIPTION_MIN, DESCRIPTION_MAX),
  category: categorySchema,
  rarity: z.enum(ACHIEVEMENT_RARITIES),
  visibility: z.enum(ACHIEVEMENT_VISIBILITIES),
  criteria: achievementCriteriaSchema,
  requiresVerification: z.boolean(),
  facetKey: z.string().max(FACET_KEY_MAX).nullable(),
  active: z.boolean(),
  ordinal: z.number().int().min(0).max(MAX_ORDINAL),
};

export const createDefinitionSchema = z
  .object({
    key: achievementKeySchema,
    ...definitionFields,
    rarity: definitionFields.rarity.default('standard'),
    visibility: definitionFields.visibility.default('public'),
    requiresVerification: definitionFields.requiresVerification.default(false),
    facetKey: definitionFields.facetKey.optional().default(null),
    active: definitionFields.active.default(true),
    ordinal: definitionFields.ordinal.default(0),
  })
  .strict();

export const updateDefinitionSchema = z
  .object({
    key: achievementKeySchema,
    patch: z
      .object({
        title: definitionFields.title.optional(),
        summary: definitionFields.summary.optional(),
        description: definitionFields.description.optional(),
        category: definitionFields.category.optional(),
        rarity: definitionFields.rarity.optional(),
        visibility: definitionFields.visibility.optional(),
        criteria: definitionFields.criteria.optional(),
        requiresVerification: definitionFields.requiresVerification.optional(),
        facetKey: definitionFields.facetKey.optional(),
        active: definitionFields.active.optional(),
        ordinal: definitionFields.ordinal.optional(),
      })
      .strict(),
  })
  .strict();

export const definitionKeyInputSchema = z.object({ key: achievementKeySchema }).strict();

const reasonSchema = multiLineText(REASON_MIN, REASON_MAX);

export const memberAchievementSchema = z
  .object({
    memberId: z.uuid(),
    key: achievementKeySchema,
  })
  .strict();

export const awardAchievementSchema = memberAchievementSchema.extend({ reason: reasonSchema });

export const revokeAchievementSchema = memberAchievementSchema.extend({ reason: reasonSchema });

export const systemAwardSchema = memberAchievementSchema.extend({
  reason: reasonSchema,
  sourceEventId: z.number().int().positive().nullable().default(null),
  /** Public Discord announcement for this award (skipped for bulk backfills). */
  announce: z.boolean().default(true),
});

export const catalogQuerySchema = z
  .object({ includeInactive: z.boolean().default(false) })
  .strict();

export const memberAchievementsQuerySchema = z
  .object({ memberId: z.uuid(), includeRevoked: z.boolean().default(false) })
  .strict();
