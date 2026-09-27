import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  achievementDefinitions,
  contributions,
  memberAchievements,
  memberCapabilities,
  projectMembers,
  projects,
  trialResults,
  trials,
  verifications,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { loadCatalog, type RankTier, rankOrdinal } from '../identity/ranks';
import { authorize, requireMember } from '../permissions/authorize';
import { loadVerification } from './repository';
import { OPEN_STATUSES, targetKeys } from './rules';
import { strategyFor } from './strategies';
import { currentVerifiedRank } from './strategies/skill';
import type { VerificationType } from './types';

/**
 * Target pickers for self-service requests: the acting member's own
 * projects, contributions, achievements, trial results and capabilities that
 * a verification request could name right now. Surfaces use this for
 * autocomplete and select menus; `requestVerification` remains the authority
 * and re-checks every rule.
 */

/** Discord shows at most 25 choices; the dashboard uses the same cap. */
export const MAX_TARGET_CANDIDATES = 25;
/** Rows read per source before search filtering. */
const CANDIDATE_SCAN_LIMIT = 200;
const MAX_SEARCH_CHARS = 64;

export const TARGET_CANDIDATE_TYPES = [
  'skill',
  'project',
  'contribution',
  'achievement',
  'trial',
] as const satisfies readonly VerificationType[];

export type TargetCandidateType = (typeof TARGET_CANDIDATE_TYPES)[number];

export const targetCandidatesSchema = z
  .object({
    type: z.enum(TARGET_CANDIDATE_TYPES),
    search: z.string().trim().max(MAX_SEARCH_CHARS).optional(),
  })
  .strict();

export interface TargetCandidate {
  type: TargetCandidateType;
  /** The id the request target takes (the facet key for skill). */
  targetId: string;
  label: string;
  /** Short secondary line, e.g. the project role or the current verified rank. */
  detail: string;
  /** Skill only: ranks that may be requested (above the current verified rank). */
  ranks: string[];
}

interface RawCandidate {
  targetId: string;
  targetKey: string;
  label: string;
  detail: string;
  ranks?: string[];
}

/** Target keys a new request would collide with: open ones, plus approved ones for single-approval types. */
async function blockedTargetKeys(
  ctx: ServiceContext,
  memberId: string,
  type: TargetCandidateType,
): Promise<Set<string>> {
  const statuses = strategyFor(type).singleApproval
    ? [...OPEN_STATUSES, 'approved' as const]
    : [...OPEN_STATUSES];
  const rows = await ctx.db
    .select({ targetKey: verifications.targetKey })
    .from(verifications)
    .where(
      and(
        eq(verifications.subjectMemberId, memberId),
        eq(verifications.type, type),
        inArray(verifications.status, statuses),
      ),
    );
  return new Set(rows.map((row) => row.targetKey));
}

async function projectCandidates(ctx: ServiceContext, memberId: string): Promise<RawCandidate[]> {
  const rows = await ctx.db
    .select({ id: projects.id, title: projects.title, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.memberId, memberId),
        isNull(projectMembers.leftAt),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(projects.updatedAt))
    .limit(CANDIDATE_SCAN_LIMIT);
  return rows.map((row) => ({
    targetId: row.id,
    targetKey: targetKeys.project(row.id, memberId),
    label: row.title,
    detail: row.role.toUpperCase(),
  }));
}

async function contributionCandidates(
  ctx: ServiceContext,
  memberId: string,
): Promise<RawCandidate[]> {
  const rows = await ctx.db
    .select({
      id: contributions.id,
      title: contributions.title,
      kind: contributions.kind,
      projectTitle: projects.title,
    })
    .from(contributions)
    .leftJoin(projects, eq(projects.id, contributions.projectId))
    .where(and(eq(contributions.memberId, memberId), eq(contributions.status, 'submitted')))
    .orderBy(desc(contributions.occurredAt))
    .limit(CANDIDATE_SCAN_LIMIT);
  return rows.map((row) => ({
    targetId: row.id,
    targetKey: targetKeys.contribution(row.id),
    label: row.title,
    detail: row.projectTitle
      ? `${row.kind.toUpperCase()} · ${row.projectTitle}`
      : row.kind.toUpperCase(),
  }));
}

async function achievementCandidates(
  ctx: ServiceContext,
  memberId: string,
): Promise<RawCandidate[]> {
  const rows = await ctx.db
    .select({ id: memberAchievements.id, title: achievementDefinitions.title })
    .from(memberAchievements)
    .innerJoin(
      achievementDefinitions,
      eq(achievementDefinitions.key, memberAchievements.achievementKey),
    )
    .where(
      and(
        eq(memberAchievements.memberId, memberId),
        isNull(memberAchievements.revokedAt),
        eq(memberAchievements.verification, 'unverified'),
      ),
    )
    .orderBy(desc(memberAchievements.awardedAt))
    .limit(CANDIDATE_SCAN_LIMIT);
  return rows.map((row) => ({
    targetId: row.id,
    targetKey: targetKeys.achievement(row.id),
    label: row.title,
    detail: 'UNVERIFIED',
  }));
}

async function trialCandidates(ctx: ServiceContext, memberId: string): Promise<RawCandidate[]> {
  const rows = await ctx.db
    .select({ id: trialResults.id, outcome: trialResults.outcome, title: trials.title })
    .from(trialResults)
    .innerJoin(trials, eq(trials.id, trialResults.trialId))
    .where(and(eq(trialResults.memberId, memberId), isNotNull(trialResults.publishedAt)))
    .orderBy(desc(trialResults.publishedAt))
    .limit(CANDIDATE_SCAN_LIMIT);
  return rows.map((row) => ({
    targetId: row.id,
    targetKey: targetKeys.trial(row.id),
    label: `${row.title} — ${row.outcome.toUpperCase()}`,
    detail: row.outcome.toUpperCase(),
  }));
}

/**
 * Tier codes strictly above `current`, highest first: what a skill request
 * may ask for, and what an approval may grant (the skill strategy refuses
 * anything at or below the verified rank).
 */
function ranksAbove(tiers: readonly RankTier[], current: string | null): string[] {
  const floor = rankOrdinal(tiers, current);
  return [...tiers]
    .reverse()
    .filter((tier) => tier.ordinal > floor)
    .map((tier) => tier.code);
}

async function skillCandidates(ctx: ServiceContext, memberId: string): Promise<RawCandidate[]> {
  const catalog = await loadCatalog(ctx);
  const rows = await ctx.db
    .select({
      facetKey: memberCapabilities.facetKey,
      verifiedRank: memberCapabilities.verifiedRank,
    })
    .from(memberCapabilities)
    .where(eq(memberCapabilities.memberId, memberId));
  const verified = new Map(rows.map((row) => [row.facetKey, row.verifiedRank]));
  return catalog.facets.flatMap((facet) => {
    const current = verified.get(facet.key) ?? null;
    const ranks = ranksAbove(catalog.tiers, current);
    if (ranks.length === 0) return [];
    const domain = catalog.domains.find((entry) => entry.key === facet.domainKey);
    return [
      {
        targetId: facet.key,
        targetKey: targetKeys.skill(memberId, facet.key),
        label: `${(domain?.label ?? facet.domainKey).toUpperCase()} · ${facet.label}`,
        detail: current ? `VERIFIED ${current}` : 'NOT VERIFIED',
        ranks,
      },
    ];
  });
}

const SOURCES: Readonly<
  Record<TargetCandidateType, (ctx: ServiceContext, memberId: string) => Promise<RawCandidate[]>>
> = {
  skill: skillCandidates,
  project: projectCandidates,
  contribution: contributionCandidates,
  achievement: achievementCandidates,
  trial: trialCandidates,
};

/**
 * The acting member's own targets of one type that a new request could name:
 * owned by them, in the state the type's strategy accepts, and not already
 * open (or, for single-approval types, approved). Self only, at most
 * MAX_TARGET_CANDIDATES, optionally filtered by a case-insensitive search.
 */
export async function listTargetCandidates(
  ctx: ServiceContext,
  input: z.input<typeof targetCandidatesSchema>,
): Promise<TargetCandidate[]> {
  const actor = requireMember(ctx);
  const query = parseInput(targetCandidatesSchema, input);
  const [raw, blocked] = await Promise.all([
    SOURCES[query.type](ctx, actor.memberId),
    blockedTargetKeys(ctx, actor.memberId, query.type),
  ]);
  const search = query.search?.toLowerCase() ?? '';
  return raw
    .filter((candidate) => !blocked.has(candidate.targetKey))
    .filter(
      (candidate) =>
        search === '' ||
        candidate.label.toLowerCase().includes(search) ||
        candidate.detail.toLowerCase().includes(search),
    )
    .slice(0, MAX_TARGET_CANDIDATES)
    .map((candidate) => ({
      type: query.type,
      targetId: candidate.targetId,
      label: candidate.label,
      detail: candidate.detail,
      ranks: candidate.ranks ?? [],
    }));
}

export const grantableRanksSchema = z.object({ verificationId: z.uuid() }).strict();

export interface GrantableRanks {
  /** The subject's verified rank for the capability now; null when not verified. */
  currentVerifiedRank: string | null;
  /** Ranks an approval may grant (above the current verified rank), highest first. */
  ranks: string[];
}

/**
 * The ranks approving a skill verification could grant right now, so a
 * verifier is only offered ranks decideVerification accepts. Empty when the
 * subject already holds the top rank. Verifiers only; decideVerification
 * re-checks under a lock when the decision is made.
 */
export async function listGrantableRanks(
  ctx: ServiceContext,
  input: z.input<typeof grantableRanksSchema>,
): Promise<GrantableRanks> {
  const { verificationId } = parseInput(grantableRanksSchema, input);
  await authorize(ctx, 'canVerifyMembers', { type: 'verification', id: verificationId });
  const verification = await loadVerification(ctx, verificationId);
  if (verification.type !== 'skill' || !verification.facetKey)
    throw new ValidationError('Only a skill verification grants a rank.');
  const [catalog, current] = await Promise.all([
    loadCatalog(ctx),
    currentVerifiedRank(ctx, verification.subjectMemberId, verification.facetKey),
  ]);
  return { currentVerifiedRank: current, ranks: ranksAbove(catalog.tiers, current) };
}
