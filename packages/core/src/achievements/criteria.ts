import { z } from 'zod';
import { achievementRarity, achievementVisibility } from '@jave/database';
import type { DomainEventType } from '../events/catalog';

/**
 * Pure achievement rules: the criteria DSL, which domain events may drive
 * achievements, and the copy derived from a definition. No I/O here.
 */

export const ACHIEVEMENT_RARITIES = achievementRarity.enumValues;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

export const ACHIEVEMENT_VISIBILITIES = achievementVisibility.enumValues;
export type AchievementVisibility = (typeof ACHIEVEMENT_VISIBILITIES)[number];

/** Upper bound for an event_count threshold. Anything higher is a typo, not a goal. */
export const MAX_EVENT_THRESHOLD = 10_000;
/** Matches domain_events.type (varchar 64). */
const EVENT_TYPE_MAX = 64;

/**
 * Domain events that may drive an event_count achievement: verified outcomes
 * decided by someone other than the member (a reviewer, a trial result,
 * staff), plus the first-step events below. This is an allow-list: an event
 * appended to the catalog later drives nothing until it is added here on
 * purpose, after asking whether it records a verified outcome.
 *
 * Deliberately absent:
 *  - Discord presence or activity is not capability (joins, RSVPs, event
 *    check-ins, games, tournament matches);
 *  - self-reported or unreviewed actions are farmable (claims, submissions of
 *    any kind, profile edits, joining a project);
 *  - negative or disciplinary outcomes are never rewarded (rejections,
 *    expiries, moderation);
 *  - events whose outcome lives only in the payload are ambiguous (a verified
 *    rank change may be a clear, a review may be a rejection);
 *  - operational and staff events carry no personal accomplishment (something
 *    was created, scheduled, published, selected or closed);
 *  - achievement events themselves, so the engine has no feedback loops.
 */
export const ACHIEVEMENT_EVENT_TYPES = [
  'application.accepted',
  'verification.approved',
  'trial.result_published',
  'trial.passed',
  'adversarial.revealed',
  'mission.completed',
  'project.created',
  'project.shipped',
  'contribution.verified',
  'research.verified',
] as const satisfies readonly DomainEventType[];

export type AchievementEventType = (typeof ACHIEVEMENT_EVENT_TYPES)[number];

/**
 * Eligible events a member triggers alone, with nobody reviewing them. They
 * mark a first step only: a rule on them must use threshold 1, so repeating
 * the action can never farm an achievement.
 */
export const FIRST_STEP_ONLY_EVENTS: ReadonlySet<AchievementEventType> =
  new Set<AchievementEventType>(['project.created']);

/** The threshold every rule on a first-step event must use. */
export const FIRST_STEP_THRESHOLD = 1;

export function isAchievementEventType(value: string): value is AchievementEventType {
  return (ACHIEVEMENT_EVENT_TYPES as readonly string[]).includes(value);
}

const eventCountCriteriaSchema = z
  .object({
    type: z.literal('event_count'),
    event: z
      .string()
      .max(EVENT_TYPE_MAX)
      .refine(isAchievementEventType, 'must be a catalog event that can drive achievements')
      .transform((value) => value as AchievementEventType),
    threshold: z.number().int().min(1).max(MAX_EVENT_THRESHOLD),
  })
  .strict()
  .refine(
    (rule) => !FIRST_STEP_ONLY_EVENTS.has(rule.event) || rule.threshold === FIRST_STEP_THRESHOLD,
    {
      path: ['threshold'],
      message: 'this event marks a first step and counts once only (threshold 1)',
    },
  );

const manualCriteriaSchema = z.object({ type: z.literal('manual') }).strict();

export const achievementCriteriaSchema = z.discriminatedUnion('type', [
  eventCountCriteriaSchema,
  manualCriteriaSchema,
]);

export type AchievementCriteriaInput = z.input<typeof achievementCriteriaSchema>;
export type ParsedAchievementCriteria = z.output<typeof achievementCriteriaSchema>;
export type EventCountCriteria = Extract<ParsedAchievementCriteria, { type: 'event_count' }>;

/** Parse stored criteria defensively: a rule that no longer validates is treated as inert. */
export function parseStoredCriteria(value: unknown): ParsedAchievementCriteria | null {
  const result = achievementCriteriaSchema.safeParse(value);
  return result.success ? result.data : null;
}

export interface DefinitionCopy {
  title: string;
  summary: string;
}

/** The one-line unlock summary; falls back to the title when none was written. */
export function unlockSummary(definition: DefinitionCopy): string {
  const summary = definition.summary.trim();
  return summary.length > 0 ? summary : `${definition.title.toUpperCase()}.`;
}

/** "BUILDER — 3 projects shipped." */
export function achievementHeadline(definition: DefinitionCopy): string {
  return `${definition.title.toUpperCase()} — ${unlockSummary(definition)}`;
}

/** "ACHIEVEMENT UNLOCKED — BUILDER — 3 projects shipped." */
export function achievementAnnouncementLine(definition: DefinitionCopy): string {
  return `ACHIEVEMENT UNLOCKED — ${achievementHeadline(definition)}`;
}

/** Definitions whose threshold is met by `count` events. */
export function thresholdsMet<T extends { criteria: EventCountCriteria }>(
  definitions: readonly T[],
  count: number,
): T[] {
  return definitions.filter((definition) => count >= definition.criteria.threshold);
}

const PERCENT_PRECISION = 10;

/** Share of `total` holding something, as a percentage with one decimal. */
export function holderPercent(holders: number, total: number): number {
  if (total <= 0 || holders <= 0) return 0;
  const ratio = Math.min(holders, total) / total;
  return Math.round(ratio * 100 * PERCENT_PRECISION) / PERCENT_PRECISION;
}
