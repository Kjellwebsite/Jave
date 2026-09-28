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
 * The verified outcome each allow-listed event records, for the criteria
 * builder. The options themselves come from the core allow-list
 * (ACHIEVEMENT_EVENT_TYPES); an event added there before it is labelled here
 * shows its type name.
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

/** "Mission verified" for `mission.completed`; the type name for an unlabelled event. */
export function ruleEventLabel(event: string): string {
  return Object.hasOwn(RULE_EVENT_LABELS, event) ? RULE_EVENT_LABELS[event as RuleEventKey] : event;
}

/** One outcome the criteria builder offers. */
export interface RuleEventOption {
  value: string;
  label: string;
  /** A member triggers it alone: a rule on it counts once only. */
  firstStep: boolean;
}

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
  return `${ruleEventLabel(criteria.event)} × ${criteria.threshold}`;
}

/** How many active members hold an achievement, and their share of all active members. */
export interface HolderShare {
  holders: number;
  /** Percent, one decimal. */
  percent: number;
}

/** An achievement as a select lists it: key and "Title · rarity". */
export interface AchievementOption {
  value: string;
  label: string;
}

/** A member's active award, as the award and revoke dialogs list it. */
export interface HeldAwardView {
  key: string;
  title: string;
  verified: boolean;
}

export type HeldAwardsResult =
  { status: 'ok'; held: HeldAwardView[] } | { status: 'error'; message: string };
