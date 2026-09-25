import { SIGNAL_DETAIL_MAX } from '../constants';

/**
 * Pure risk model. Each violation contributes a named weight (0–100, read as
 * "percent likelihood this alone is abuse"). Weights combine as a noisy-OR —
 * 100·(1 − Π(1 − wᵢ/100)) — so independent evidence accumulates but saturates
 * below 100 instead of summing past it. Context (account age, how recently the
 * author joined, raid mode) never creates risk on its own; it only amplifies
 * risk that violations already established.
 */

export type SignalKey =
  | 'spam_rate'
  | 'duplicate_content'
  | 'mention_spam'
  | 'everyone_mention'
  | 'blocked_link'
  | 'unlisted_link'
  | 'lookalike_domain'
  | 'obfuscated_link'
  | 'foreign_invite'
  | 'very_new_account'
  | 'new_account'
  | 'no_avatar'
  | 'username_link'
  | 'impersonation_name'
  | 'generated_name'
  | 'join_burst';

export interface RiskSignal {
  key: SignalKey;
  weight: number;
  detail?: string;
}

export type ModifierKey = 'very_new_account' | 'new_account' | 'new_member' | 'raid_mode';

export interface RiskModifier {
  key: ModifierKey;
  /** Multiplier applied to the combined violation risk. */
  factor: number;
  detail: string;
}

/** Base weights for message violations. */
export const MESSAGE_SIGNAL_WEIGHTS = {
  spam_rate: 60,
  spam_rate_severe: 75,
  duplicate_content: 40,
  duplicate_content_severe: 55,
  mention_spam: 55,
  mention_spam_severe: 75,
  everyone_mention: 35,
  blocked_link: 50,
  unlisted_link: 30,
  lookalike_domain: 80,
  obfuscated_link: 25,
  foreign_invite: 45,
} as const;

/** A count at or beyond this multiple of its limit uses the "severe" weight. */
export const SEVERE_MULTIPLE = 2;

/** Base weights for join screening. */
export const JOIN_SIGNAL_WEIGHTS = {
  very_new_account: 50,
  new_account: 30,
  no_avatar: 10,
  username_link: 40,
  impersonation_name: 25,
  generated_name: 10,
  join_burst: 35,
} as const;

/** Context amplifiers for message risk. */
export const RISK_MODIFIERS = {
  /** Account created less than VERY_NEW_ACCOUNT_DAYS ago. */
  veryNewAccount: 1.35,
  /** Account younger than the configured suspicious age. */
  newAccount: 1.2,
  /** Joined the server less than NEW_MEMBER_MINUTES ago. */
  newMember: 1.15,
  /** Raid mode is active. */
  raidMode: 1.2,
} as const;

export const VERY_NEW_ACCOUNT_DAYS = 1;
export const DEFAULT_NEW_ACCOUNT_DAYS = 7;
export const NEW_MEMBER_MINUTES = 30;
/** Combined amplification is capped so context never dominates evidence. */
export const MAX_RISK_MULTIPLIER = 1.6;

/** Automod times out at or above this risk (quarantine threshold comes from settings). */
export const AUTOMOD_TIMEOUT_RISK_SCORE = 60;

export const MAX_RISK_SCORE = 100;

export type AutomodAction = 'none' | 'delete' | 'timeout' | 'quarantine';

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(MAX_RISK_SCORE, Math.max(0, weight));
}

/** Noisy-OR combination of weights, 0–100 (not rounded). */
export function combineWeights(weights: readonly number[]): number {
  let remaining = 1;
  for (const weight of weights) remaining *= 1 - clampWeight(weight) / MAX_RISK_SCORE;
  return (1 - remaining) * MAX_RISK_SCORE;
}

export interface ModifierContext {
  accountAgeDays: number | null;
  memberAgeMinutes?: number | null;
  raidMode?: boolean;
  newAccountDays?: number;
}

export function riskModifiers(context: ModifierContext): RiskModifier[] {
  const modifiers: RiskModifier[] = [];
  const newAccountDays = context.newAccountDays ?? DEFAULT_NEW_ACCOUNT_DAYS;
  const age = context.accountAgeDays;
  if (age !== null && Number.isFinite(age) && age >= 0) {
    if (age < VERY_NEW_ACCOUNT_DAYS) {
      modifiers.push({
        key: 'very_new_account',
        factor: RISK_MODIFIERS.veryNewAccount,
        detail: 'account created less than a day ago',
      });
    } else if (age < newAccountDays) {
      modifiers.push({
        key: 'new_account',
        factor: RISK_MODIFIERS.newAccount,
        detail: `account ${Math.floor(age)} days old`,
      });
    }
  }
  const memberAge = context.memberAgeMinutes;
  if (
    memberAge !== null &&
    memberAge !== undefined &&
    Number.isFinite(memberAge) &&
    memberAge >= 0 &&
    memberAge < NEW_MEMBER_MINUTES
  ) {
    modifiers.push({
      key: 'new_member',
      factor: RISK_MODIFIERS.newMember,
      detail: `joined ${Math.floor(memberAge)} min ago`,
    });
  }
  if (context.raidMode) {
    modifiers.push({
      key: 'raid_mode',
      factor: RISK_MODIFIERS.raidMode,
      detail: 'raid mode active',
    });
  }
  return modifiers;
}

/** Final 0–100 score: combined violation weights × capped context multiplier. */
export function scoreRisk(
  signals: readonly Pick<RiskSignal, 'weight'>[],
  modifiers: readonly Pick<RiskModifier, 'factor'>[],
): number {
  if (signals.length === 0) return 0;
  const base = combineWeights(signals.map((s) => s.weight));
  const multiplier = Math.min(
    MAX_RISK_MULTIPLIER,
    modifiers.reduce((product, m) => product * Math.max(1, m.factor), 1),
  );
  return Math.min(MAX_RISK_SCORE, Math.round(base * multiplier));
}

/**
 * Action ladder: any violation deletes; risk at the timeout threshold times
 * out; risk at the configured quarantine threshold quarantines.
 */
export function decideAction(
  riskScore: number,
  hasViolation: boolean,
  quarantineRiskScore: number,
): AutomodAction {
  if (!hasViolation) return 'none';
  if (riskScore >= quarantineRiskScore) return 'quarantine';
  if (riskScore >= AUTOMOD_TIMEOUT_RISK_SCORE) return 'timeout';
  return 'delete';
}

export function signalDetail(detail: string): string {
  return detail.length <= SIGNAL_DETAIL_MAX ? detail : `${detail.slice(0, SIGNAL_DETAIL_MAX - 1)}…`;
}
