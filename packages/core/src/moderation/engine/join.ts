import type { Settings } from '../../settings/schemas';
import { extractInvites, extractLinks } from './links';
import { normalizeForComparison, skeleton } from './normalize';
import {
  combineWeights,
  JOIN_SIGNAL_WEIGHTS,
  type RiskSignal,
  signalDetail,
  VERY_NEW_ACCOUNT_DAYS,
} from './risk';

/** Joins scoring at least this are suspicious even with an established account. */
export const JOIN_SUSPICIOUS_RISK_SCORE = 40;

/** Names that imitate staff or the platform (compared on the lookalike skeleton). */
const IMPERSONATION_TERMS = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'staff',
  'support',
  'official',
  'founder',
  'jave',
  'javelin',
  'discord',
  'system',
  'security',
];
const IMPERSONATION_SKELETONS = IMPERSONATION_TERMS.map((term) => skeleton(term));

/** `name1234567`, `user_58213` and similar generated handles. */
const GENERATED_NAME = /^[a-z]+[._-]?\d{4,}$/;
const DIGIT_HEAVY_MIN_LENGTH = 6;
const DIGIT_HEAVY_RATIO = 0.5;
const MS_PER_SECOND = 1000;

export interface JoinInput {
  accountAgeDays: number;
  hasAvatar: boolean;
  username: string;
  displayName?: string | null;
  /** Join timestamps in the burst window, including this join. */
  recentJoins: readonly Date[];
  now: Date;
  settings: Settings<'security'>;
}

export interface JoinEvaluation {
  suspicious: boolean;
  raidDetected: boolean;
  riskScore: number;
  signals: RiskSignal[];
  joinsInWindow: number;
}

function nameSignals(username: string, displayName: string | null | undefined): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const names = [username, displayName ?? ''].filter(Boolean);
  if (names.some((name) => extractLinks(name).length > 0 || extractInvites(name).length > 0)) {
    signals.push({
      key: 'username_link',
      weight: JOIN_SIGNAL_WEIGHTS.username_link,
      detail: 'link or invite in name',
    });
  }
  const tokens = names.flatMap((name) =>
    skeleton(normalizeForComparison(name.replace(/[._-]+/g, ' '))).split(/\s+/),
  );
  const impersonated = tokens.find((token) =>
    IMPERSONATION_SKELETONS.some((term) => token === term),
  );
  if (impersonated) {
    signals.push({
      key: 'impersonation_name',
      weight: JOIN_SIGNAL_WEIGHTS.impersonation_name,
      detail: signalDetail(`name resembles "${impersonated}"`),
    });
  }
  const plain = username.toLowerCase();
  const digits = (plain.match(/\d/g) ?? []).length;
  if (
    GENERATED_NAME.test(plain) ||
    (plain.length >= DIGIT_HEAVY_MIN_LENGTH && digits / plain.length >= DIGIT_HEAVY_RATIO)
  ) {
    signals.push({
      key: 'generated_name',
      weight: JOIN_SIGNAL_WEIGHTS.generated_name,
      detail: 'generated-looking username',
    });
  }
  return signals;
}

/**
 * Screen a guild join. Pure: suspicious-account signals plus join-burst (raid)
 * detection over the configured window.
 */
export function evaluateJoin(input: JoinInput): JoinEvaluation {
  const { settings } = input;
  const signals: RiskSignal[] = [];
  const age = Number.isFinite(input.accountAgeDays) ? Math.max(0, input.accountAgeDays) : 0;
  if (age < VERY_NEW_ACCOUNT_DAYS) {
    signals.push({
      key: 'very_new_account',
      weight: JOIN_SIGNAL_WEIGHTS.very_new_account,
      detail: 'account created less than a day ago',
    });
  } else if (age < settings.suspiciousAccountAgeDays) {
    signals.push({
      key: 'new_account',
      weight: JOIN_SIGNAL_WEIGHTS.new_account,
      detail: `account ${Math.floor(age)} days old`,
    });
  }
  if (!input.hasAvatar) {
    signals.push({ key: 'no_avatar', weight: JOIN_SIGNAL_WEIGHTS.no_avatar, detail: 'no avatar' });
  }
  signals.push(...nameSignals(input.username, input.displayName));

  const now = input.now.getTime();
  const cutoff = now - settings.joinBurstWindowSeconds * MS_PER_SECOND;
  const joinsInWindow = input.recentJoins.filter((at) => {
    const t = at.getTime();
    return Number.isFinite(t) && t > cutoff && t <= now;
  }).length;
  const raidDetected = joinsInWindow >= settings.joinBurstCount;
  if (raidDetected) {
    signals.push({
      key: 'join_burst',
      weight: JOIN_SIGNAL_WEIGHTS.join_burst,
      detail: `${joinsInWindow} joins in ${settings.joinBurstWindowSeconds}s (limit ${settings.joinBurstCount})`,
    });
  }

  const riskScore = Math.round(combineWeights(signals.map((s) => s.weight)));
  const newAccount = age < settings.suspiciousAccountAgeDays;
  return {
    suspicious: newAccount || riskScore >= JOIN_SUSPICIOUS_RISK_SCORE,
    raidDetected,
    riskScore,
    signals,
    joinsInWindow,
  };
}
