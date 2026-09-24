import { DAY, HOUR } from '../kernel/clock';
import { isStaffRole, type OrgRole, PROGRESSION_ROLES, roleRank } from '../permissions/roles';
import { MIN_LONG_ANSWER_CHARS } from './schemas';
import type { ApplicationRecommendation } from './state-machine';

/** Pure policy for the application workflow. No I/O. */

export type ApplicationRequirement = 'domain' | 'motivation' | 'experience' | 'proof_of_work';

export interface ApplicationContent {
  domainKey: string | null;
  motivation: string | null;
  experience: string | null;
  projects: string | null;
  portfolioUrl: string | null;
  evidenceLinks: readonly string[];
}

/**
 * What still blocks submission. "Proof of work" means at least one of
 * projects, a portfolio URL or an evidence link: claims need something to check.
 */
export function missingRequirements(app: ApplicationContent): ApplicationRequirement[] {
  const missing: ApplicationRequirement[] = [];
  if (!app.domainKey) missing.push('domain');
  if ((app.motivation?.length ?? 0) < MIN_LONG_ANSWER_CHARS) missing.push('motivation');
  if ((app.experience?.length ?? 0) < MIN_LONG_ANSWER_CHARS) missing.push('experience');
  const hasProof =
    Boolean(app.projects && app.projects.length > 0) ||
    Boolean(app.portfolioUrl) ||
    app.evidenceLinks.length > 0;
  if (!hasProof) missing.push('proof_of_work');
  return missing;
}

export const REQUIREMENT_MESSAGES: Readonly<Record<ApplicationRequirement, string>> = {
  domain: 'Choose a primary domain.',
  motivation: `Motivation needs at least ${MIN_LONG_ANSWER_CHARS} characters.`,
  experience: `Experience needs at least ${MIN_LONG_ANSWER_CHARS} characters.`,
  proof_of_work: 'Add projects, a portfolio URL or at least one evidence link.',
};

/** Roles that already place a member inside JAVELIN; they do not apply. */
const ALREADY_IN_ROLES: readonly OrgRole[] = ['trial', 'verified'];

export function isEligibleToApply(roles: readonly OrgRole[]): boolean {
  return !roles.some((role) => isStaffRole(role) || ALREADY_IN_ROLES.includes(role));
}

/** Progression role currently held (progression roles are mutually exclusive). */
export function progressionRole(roles: readonly OrgRole[]): OrgRole | null {
  return PROGRESSION_ROLES.find((role) => roles.includes(role)) ?? null;
}

/** Submitting grants APPLICANT only to plain members (or people with no progression role). */
export function shouldGrantApplicant(roles: readonly OrgRole[]): boolean {
  if (!isEligibleToApply(roles)) return false;
  const current = progressionRole(roles);
  return current === null || current === 'member';
}

/** Roles an acceptance may grant. Anything else in settings is a misconfiguration. */
export const ACCEPTANCE_ROLES: readonly OrgRole[] = ['trial', 'verified'];

/**
 * The role to grant on acceptance, or null when the member already holds a
 * progression role at or above it (acceptance never demotes).
 */
export function acceptanceGrant(roles: readonly OrgRole[], acceptedRole: OrgRole): OrgRole | null {
  const current = progressionRole(roles);
  if (current && roleRank(current) >= roleRank(acceptedRole)) return null;
  return acceptedRole;
}

/** When a rejection cooldown ends, or null when none applies at `now`. */
export function cooldownEndsAt(
  lastRejectedAt: Date | null,
  cooldownDays: number,
  now: Date,
): Date | null {
  if (!lastRejectedAt || cooldownDays <= 0) return null;
  const ends = new Date(lastRejectedAt.getTime() + cooldownDays * DAY);
  return ends.getTime() > now.getTime() ? ends : null;
}

/** When an untouched draft expires. */
export function draftExpiresAt(lastEditedAt: Date, expiryDays: number): Date {
  return new Date(lastEditedAt.getTime() + expiryDays * DAY);
}

export function reviewReminderCutoff(now: Date, reminderHours: number): Date {
  return new Date(now.getTime() - reminderHours * HOUR);
}

export interface ReviewTally {
  accept: number;
  reject: number;
  interview: number;
  abstain: number;
  /** Reviews that count toward minReviewsBeforeDecision (abstentions do not). */
  counted: number;
  /** Mean score of scored reviews, one decimal; null when none. */
  averageScore: number | null;
}

/** Average scores are shown to one decimal place. */
const SCORE_PRECISION = 10;

export function tallyReviews(
  reviews: readonly { recommendation: ApplicationRecommendation; score: number | null }[],
): ReviewTally {
  const tally: ReviewTally = {
    accept: 0,
    reject: 0,
    interview: 0,
    abstain: 0,
    counted: 0,
    averageScore: null,
  };
  let scoreSum = 0;
  let scored = 0;
  for (const review of reviews) {
    tally[review.recommendation]++;
    if (review.recommendation !== 'abstain') tally.counted++;
    if (review.score !== null) {
      scoreSum += review.score;
      scored++;
    }
  }
  tally.averageScore =
    scored > 0 ? Math.round((scoreSum / scored) * SCORE_PRECISION) / SCORE_PRECISION : null;
  return tally;
}
