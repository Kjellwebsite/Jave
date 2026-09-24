/**
 * Referral anomaly detection. Pure: callers load the data, this decides.
 *
 * The goal is not to punish, it is to avoid rewarding invite farming. Any flag
 * keeps a referral off the leaderboard until staff review it; a score at or
 * above `settings.analytics.referralAnomalyThreshold` also blocks VALID.
 */
import { DAY, HOUR } from '../kernel/clock';

export const ANOMALY_FLAGS = [
  'self_invite',
  'new_account',
  'join_burst',
  'new_account_share',
  'fast_leave',
  'fast_leave_share',
  'similar_usernames',
  'rejoin',
] as const;

export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

/** Contribution of each flag to the 0–100 score. Self-invites are always 100. */
export const ANOMALY_WEIGHTS: Readonly<Record<AnomalyFlag, number>> = {
  self_invite: 100,
  new_account: 15,
  join_burst: 30,
  new_account_share: 25,
  fast_leave: 30,
  fast_leave_share: 25,
  similar_usernames: 30,
  rejoin: 35,
};

export const MAX_ANOMALY_SCORE = 100;

export interface AnomalyRules {
  /** Accounts younger than this at join time are "very new". */
  newAccountDays: number;
  /** Burst: at least `burstThreshold` joins by one inviter inside `burstWindowMs`. */
  burstWindowMs: number;
  burstThreshold: number;
  /** Share-based signals need at least this many referrals to say anything. */
  cohortMinSample: number;
  newAccountShare: number;
  fastLeaveShare: number;
  /** Similar-username flag needs this many other similar invitees. */
  similarNameMatches: number;
  fastLeaveMs: number;
}

export const DEFAULT_ANOMALY_RULES: Readonly<AnomalyRules> = {
  newAccountDays: 7,
  burstWindowMs: HOUR,
  burstThreshold: 5,
  cohortMinSample: 4,
  newAccountShare: 0.5,
  fastLeaveShare: 0.4,
  similarNameMatches: 2,
  fastLeaveMs: DAY,
};

/** Window of an inviter's other referrals considered around a join. */
export const ANOMALY_COHORT_WINDOW_MS = 30 * DAY;
/** Most other referrals loaded for one scoring pass. */
export const ANOMALY_COHORT_LIMIT = 200;

export interface ReferralSubject {
  joinedAt: Date;
  /** Discord account creation time (from the snowflake). */
  accountCreatedAt: Date | null;
  username: string;
  leftAt: Date | null;
}

export interface AnomalyInput {
  inviterUserId: string | null;
  inviteeUserId: string;
  subject: ReferralSubject;
  /** The same inviter's other referrals inside the cohort window (never the subject itself). */
  cohort: readonly ReferralSubject[];
  /** The invitee had joined before (an earlier referral or an older join event). */
  rejoin: boolean;
}

export interface AnomalyResult {
  flags: AnomalyFlag[];
  score: number;
}

const SIMILARITY_MIN_SKELETON = 3;
const SIMILARITY_MIN_LENGTH = 5;
/** Allowed edit distance per this many characters of the shorter name. */
const SIMILARITY_CHARS_PER_EDIT = 5;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
}

/** Letters only, repeated letters collapsed: farm_bot_01 → farmbot, xxkiller99 → xkiler. */
function nameSkeleton(name: string): string {
  return normalizeName(name)
    .replace(/[0-9]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Heuristic for mass-created accounts: same letter skeleton, or a near-identical name. */
export function isSimilarUsername(a: string, b: string): boolean {
  const skeletonA = nameSkeleton(a);
  if (skeletonA.length >= SIMILARITY_MIN_SKELETON && skeletonA === nameSkeleton(b)) return true;
  const left = normalizeName(a);
  const right = normalizeName(b);
  const shorter = Math.min(left.length, right.length);
  if (shorter < SIMILARITY_MIN_LENGTH) return false;
  if (Math.abs(left.length - right.length) > shorter) return false;
  return levenshtein(left, right) <= Math.floor(shorter / SIMILARITY_CHARS_PER_EDIT);
}

function isNewAccount(subject: ReferralSubject, rules: AnomalyRules): boolean {
  if (!subject.accountCreatedAt) return false;
  const age = subject.joinedAt.getTime() - subject.accountCreatedAt.getTime();
  return age < rules.newAccountDays * DAY;
}

function isFastLeave(subject: ReferralSubject, rules: AnomalyRules): boolean {
  if (!subject.leftAt) return false;
  return subject.leftAt.getTime() - subject.joinedAt.getTime() < rules.fastLeaveMs;
}

/** Is the subject's join inside some window of `burstWindowMs` holding ≥ threshold joins? */
function inBurst(
  subject: ReferralSubject,
  cohort: readonly ReferralSubject[],
  rules: AnomalyRules,
) {
  const at = subject.joinedAt.getTime();
  const times = [at, ...cohort.map((c) => c.joinedAt.getTime())].sort((x, y) => x - y);
  let end = 0;
  for (let start = 0; start < times.length; start++) {
    if (end < start) end = start;
    while (end + 1 < times.length && times[end + 1]! - times[start]! <= rules.burstWindowMs) end++;
    const count = end - start + 1;
    if (count >= rules.burstThreshold && times[start]! <= at && at <= times[end]!) return true;
  }
  return false;
}

function shareAtLeast(
  sample: readonly ReferralSubject[],
  predicate: (s: ReferralSubject) => boolean,
  minSample: number,
  share: number,
): boolean {
  if (sample.length < minSample) return false;
  const hits = sample.filter(predicate).length;
  return hits / sample.length >= share;
}

/** Sum of flag weights, capped at 100. A self-invite is always 100. */
export function scoreFlags(flags: readonly AnomalyFlag[]): number {
  if (flags.includes('self_invite')) return MAX_ANOMALY_SCORE;
  const total = [...new Set(flags)].reduce((sum, flag) => sum + ANOMALY_WEIGHTS[flag], 0);
  return Math.min(MAX_ANOMALY_SCORE, total);
}

/** Add a flag (idempotent) and return flags in catalog order. */
export function withFlag(flags: readonly string[], flag: AnomalyFlag): AnomalyFlag[] {
  const known = new Set(flags.filter(isAnomalyFlag));
  known.add(flag);
  return ANOMALY_FLAGS.filter((f) => known.has(f));
}

export function isAnomalyFlag(value: string): value is AnomalyFlag {
  return (ANOMALY_FLAGS as readonly string[]).includes(value);
}

export function detectAnomalies(
  input: AnomalyInput,
  rules: AnomalyRules = DEFAULT_ANOMALY_RULES,
): AnomalyResult {
  const flags = new Set<AnomalyFlag>();
  const { subject } = input;
  if (input.inviterUserId !== null && input.inviterUserId === input.inviteeUserId) {
    flags.add('self_invite');
  }
  if (isNewAccount(subject, rules)) flags.add('new_account');
  if (isFastLeave(subject, rules)) flags.add('fast_leave');
  if (input.rejoin) flags.add('rejoin');

  // Cohort signals describe the inviter, so they need one.
  if (input.inviterUserId !== null) {
    const cohort = input.cohort;
    const sample = [subject, ...cohort];
    if (inBurst(subject, cohort, rules)) flags.add('join_burst');
    if (
      shareAtLeast(
        sample,
        (s) => isNewAccount(s, rules),
        rules.cohortMinSample,
        rules.newAccountShare,
      )
    ) {
      flags.add('new_account_share');
    }
    if (
      shareAtLeast(
        sample,
        (s) => isFastLeave(s, rules),
        rules.cohortMinSample,
        rules.fastLeaveShare,
      )
    ) {
      flags.add('fast_leave_share');
    }
    const similar = cohort.filter((c) => isSimilarUsername(subject.username, c.username)).length;
    if (similar >= rules.similarNameMatches) flags.add('similar_usernames');
  }

  const ordered = ANOMALY_FLAGS.filter((f) => flags.has(f));
  return { flags: ordered, score: scoreFlags(ordered) };
}
