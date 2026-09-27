import type { BadgeTone } from '@jave/ui';

/** Human copy for achievement enums and rules (catalog, forms, criteria builder). */
export const RARITY_LABELS = {
  standard: 'Standard',
  notable: 'Notable',
  rare: 'Rare',
  exceptional: 'Exceptional',
  singular: 'Singular',
} as const;

export type RarityKey = keyof typeof RARITY_LABELS;

/** Near-monochrome: rarity is a label, not a colour — only the rarest earn the accent. */
export const RARITY_TONE: Record<RarityKey, BadgeTone> = {
  standard: 'neutral',
  notable: 'neutral',
  rare: 'info',
  exceptional: 'accent',
  singular: 'accent',
};

export const VISIBILITY_LABELS = {
  public: 'Public',
  hidden: 'Hidden until unlocked',
} as const;

export type VisibilityKey = keyof typeof VISIBILITY_LABELS;

/**
 * The events a rule may count (the core allow-list), described as the verified
 * outcome they record. Kept in the same order as ACHIEVEMENT_EVENT_TYPES.
 */
export const RULE_EVENT_LABELS = {
  'application.accepted': 'Application accepted',
  'verification.approved': 'Verification approved',
  'trial.result_published': 'Trial result published',
  'trial.passed': 'Trial passed',
  'adversarial.revealed': 'Adversary revealed',
  'mission.completed': 'Mission verified',
  'project.created': 'Project created (first step)',
  'project.shipped': 'Project shipped',
  'contribution.verified': 'Contribution verified',
  'research.verified': 'Research verified',
} as const;

export type RuleEventKey = keyof typeof RULE_EVENT_LABELS;

export const RULE_TYPE_LABELS = {
  manual: 'Manual — awarded by staff',
  event_count: 'Rule — count verified outcomes',
} as const;

export type RuleTypeKey = keyof typeof RULE_TYPE_LABELS;

export type RuleView =
  { type: 'manual' } | { type: 'event_count'; event: string; threshold: number };

/** "Mission verified × 10", "Manual", or "Inert rule" for a stored rule that no longer validates. */
export function ruleText(criteria: RuleView | null): string {
  if (!criteria) return 'Inert rule';
  if (criteria.type === 'manual') return 'Manual';
  const label = Object.hasOwn(RULE_EVENT_LABELS, criteria.event)
    ? RULE_EVENT_LABELS[criteria.event as RuleEventKey]
    : criteria.event;
  return `${label} × ${criteria.threshold}`;
}
