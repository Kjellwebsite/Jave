import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  capabilityFacets,
  contributions,
  memberCapabilities,
  members,
  missionAssignments,
  projects,
  rankTiers,
  trialResults,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { loadCatalog } from '../identity/ranks';
import { authorizeAnalytics } from './access';
import { type ProgressionRole, progressionCounts } from './queries/people';

export interface TierCount {
  code: string;
  label: string;
  count: number;
}

/**
 * One domain's capability picture across present members. A member's domain
 * rank is their peak verified facet rank (never a sum). Every present member
 * is exactly one of: verified (in `tiers`), claimed only, or unknown.
 */
export interface DomainDistribution {
  domainKey: string;
  label: string;
  tiers: TierCount[];
  verified: number;
  claimedOnly: number;
  unknown: number;
}

export interface JavelinProgress {
  generatedAt: Date;
  /** Published trial results with outcome pass or distinction. */
  trialsPassed: number;
  projectsShipped: number;
  verifiedContributions: number;
  /** Verified mission assignments. */
  missionsCompleted: number;
  presentMembers: number;
  progression: Record<ProgressionRole, number>;
  capabilityDistribution: DomainDistribution[];
}

async function totals(ctx: ServiceContext) {
  const [[trials], [shipped], [contribs], [missions], [present]] = await Promise.all([
    ctx.db
      .select({ value: count() })
      .from(trialResults)
      .where(
        and(
          inArray(trialResults.outcome, ['pass', 'distinction']),
          sql`${trialResults.publishedAt} is not null`,
        ),
      ),
    ctx.db
      .select({ value: count() })
      .from(projects)
      .where(and(eq(projects.status, 'shipped'), isNull(projects.deletedAt))),
    ctx.db
      .select({ value: count() })
      .from(contributions)
      .where(eq(contributions.status, 'verified')),
    ctx.db
      .select({ value: count() })
      .from(missionAssignments)
      .where(eq(missionAssignments.status, 'verified')),
    ctx.db
      .select({ value: count() })
      .from(members)
      .where(and(eq(members.guildStatus, 'present'), isNull(members.deletedAt))),
  ]);
  return {
    trialsPassed: trials?.value ?? 0,
    projectsShipped: shipped?.value ?? 0,
    verifiedContributions: contribs?.value ?? 0,
    missionsCompleted: missions?.value ?? 0,
    presentMembers: present?.value ?? 0,
  };
}

/** Per (domain, peak verified tier) counts and per-domain claimed-only counts. */
async function capabilityRows(ctx: ServiceContext) {
  const perMemberDomain = ctx.db.$with('per_member_domain').as(
    ctx.db
      .select({
        memberId: memberCapabilities.memberId,
        domainKey: capabilityFacets.domainKey,
        peakOrdinal: sql<number | null>`max(${rankTiers.ordinal})`.as('peak_ordinal'),
        hasClaim: sql<boolean>`bool_or(${memberCapabilities.claimedRank} is not null)`.as(
          'has_claim',
        ),
      })
      .from(memberCapabilities)
      .innerJoin(capabilityFacets, eq(capabilityFacets.key, memberCapabilities.facetKey))
      .innerJoin(
        members,
        and(
          eq(members.id, memberCapabilities.memberId),
          eq(members.guildStatus, 'present'),
          isNull(members.deletedAt),
        ),
      )
      .leftJoin(rankTiers, eq(rankTiers.code, memberCapabilities.verifiedRank))
      .groupBy(memberCapabilities.memberId, capabilityFacets.domainKey),
  );
  return ctx.db
    .with(perMemberDomain)
    .select({
      domainKey: perMemberDomain.domainKey,
      tierCode: rankTiers.code,
      tierLabel: rankTiers.label,
      tierOrdinal: rankTiers.ordinal,
      verified: sql<number>`count(*) filter (where ${perMemberDomain.peakOrdinal} is not null)::int`,
      claimedOnly: sql<number>`count(*) filter (where ${perMemberDomain.peakOrdinal} is null and ${perMemberDomain.hasClaim})::int`,
    })
    .from(perMemberDomain)
    .leftJoin(rankTiers, eq(rankTiers.ordinal, perMemberDomain.peakOrdinal))
    .groupBy(perMemberDomain.domainKey, rankTiers.code, rankTiers.label, rankTiers.ordinal)
    .orderBy(asc(perMemberDomain.domainKey), asc(rankTiers.ordinal));
}

function buildDistribution(
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  rows: Awaited<ReturnType<typeof capabilityRows>>,
  presentMembers: number,
): DomainDistribution[] {
  return catalog.domains.map((domain) => {
    const domainRows = rows.filter((r) => r.domainKey === domain.key);
    const tiers: TierCount[] = catalog.tiers.map((tier) => ({
      code: tier.code,
      label: tier.label,
      count: domainRows.find((r) => r.tierCode === tier.code)?.verified ?? 0,
    }));
    // A verified rank on a tier that has since been disabled is still a fact.
    for (const row of domainRows) {
      if (row.tierCode && !tiers.some((t) => t.code === row.tierCode)) {
        tiers.push({
          code: row.tierCode,
          label: row.tierLabel ?? row.tierCode,
          count: row.verified,
        });
      }
    }
    const verified = tiers.reduce((sum, t) => sum + t.count, 0);
    const claimedOnly = domainRows.reduce((sum, r) => sum + r.claimedOnly, 0);
    return {
      domainKey: domain.key,
      label: domain.label,
      tiers,
      verified,
      claimedOnly,
      unknown: Math.max(0, presentMembers - verified - claimedOnly),
    };
  });
}

/**
 * What JAVELIN has proven so far: outcomes (trials passed, projects shipped,
 * verified contributions, missions completed), where members stand in the
 * progression ladder, and verified capability per domain by rank tier.
 * Descriptive; there is no cross-domain aggregate.
 */
export async function getJavelinProgress(ctx: ServiceContext): Promise<JavelinProgress> {
  await authorizeAnalytics(ctx, 'progress');
  const [counts, progression, rows, catalog] = await Promise.all([
    totals(ctx),
    progressionCounts(ctx),
    capabilityRows(ctx),
    loadCatalog(ctx),
  ]);
  return {
    generatedAt: ctx.clock.now(),
    ...counts,
    progression,
    capabilityDistribution: buildDistribution(catalog, rows, counts.presentMembers),
  };
}
