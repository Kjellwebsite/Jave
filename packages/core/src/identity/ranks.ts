import { asc, eq } from 'drizzle-orm';
import { capabilityDomains, capabilityFacets, rankTiers } from '@jave/database';
import type { ServiceContext } from '../kernel/context';

export type CapabilityStatus = 'verified' | 'claimed' | 'unknown';

export interface RankTier {
  code: string;
  ordinal: number;
  label: string;
  description: string;
}

export interface FacetDefinition {
  key: string;
  domainKey: string;
  label: string;
  description: string;
  ordinal: number;
}

export interface DomainDefinition {
  key: string;
  label: string;
  description: string;
  ordinal: number;
}

export interface Catalog {
  tiers: RankTier[];
  domains: DomainDefinition[];
  facets: FacetDefinition[];
}

const CATALOG_TTL_MS = 60_000;

/** Enabled rank tiers, domains and facets, ordered. Cached per process. */
export async function loadCatalog(ctx: ServiceContext): Promise<Catalog> {
  return ctx.cache.getOrLoad('identity:catalog', CATALOG_TTL_MS, async () => {
    const [tiers, domains, facets] = await Promise.all([
      ctx.db
        .select()
        .from(rankTiers)
        .where(eq(rankTiers.enabled, true))
        .orderBy(asc(rankTiers.ordinal)),
      ctx.db.select().from(capabilityDomains).orderBy(asc(capabilityDomains.ordinal)),
      ctx.db
        .select()
        .from(capabilityFacets)
        .where(eq(capabilityFacets.enabled, true))
        .orderBy(asc(capabilityFacets.ordinal)),
    ]);
    return {
      tiers: tiers.map(({ code, ordinal, label, description }) => ({
        code,
        ordinal,
        label,
        description,
      })),
      domains,
      facets: facets.map(({ key, domainKey, label, description, ordinal }) => ({
        key,
        domainKey,
        label,
        description,
        ordinal,
      })),
    };
  });
}

export function capabilityStatus(row: {
  claimedRank: string | null;
  verifiedRank: string | null;
}): CapabilityStatus {
  if (row.verifiedRank) return 'verified';
  if (row.claimedRank) return 'claimed';
  return 'unknown';
}

export function rankOrdinal(tiers: readonly RankTier[], code: string | null): number {
  if (!code) return -1;
  return tiers.find((t) => t.code === code)?.ordinal ?? -1;
}

/** Returns the higher of two ranks (null-safe). */
export function maxRank(
  tiers: readonly RankTier[],
  a: string | null,
  b: string | null,
): string | null {
  if (!a) return b;
  if (!b) return a;
  return rankOrdinal(tiers, a) >= rankOrdinal(tiers, b) ? a : b;
}

export function compareRanks(
  tiers: readonly RankTier[],
  a: string | null,
  b: string | null,
): number {
  return rankOrdinal(tiers, a) - rankOrdinal(tiers, b);
}

export interface FacetState {
  facetKey: string;
  claimedRank: string | null;
  verifiedRank: string | null;
}

export interface FacetSummary extends FacetState {
  label: string;
  status: CapabilityStatus;
}

export interface DomainSummary {
  key: string;
  label: string;
  /** Peak verified facet rank in the domain. */
  verifiedRank: string | null;
  /** Peak claimed facet rank in the domain. */
  claimedRank: string | null;
  status: CapabilityStatus;
  facets: FacetSummary[];
}

/**
 * Summarize a member's facets into domains. A domain's rank is its peak
 * facet rank — descriptive of demonstrated capability, never a sum. There is
 * deliberately no cross-domain aggregate.
 */
export function summarizeDomains(catalog: Catalog, states: readonly FacetState[]): DomainSummary[] {
  const byFacet = new Map(states.map((s) => [s.facetKey, s]));
  return catalog.domains.map((domain) => {
    const facets = catalog.facets
      .filter((f) => f.domainKey === domain.key)
      .map((facet): FacetSummary => {
        const state = byFacet.get(facet.key);
        const claimedRank = state?.claimedRank ?? null;
        const verifiedRank = state?.verifiedRank ?? null;
        return {
          facetKey: facet.key,
          label: facet.label,
          claimedRank,
          verifiedRank,
          status: capabilityStatus({ claimedRank, verifiedRank }),
        };
      });
    const verifiedRank = facets.reduce<string | null>(
      (acc, f) => maxRank(catalog.tiers, acc, f.verifiedRank),
      null,
    );
    const claimedRank = facets.reduce<string | null>(
      (acc, f) => maxRank(catalog.tiers, acc, f.claimedRank),
      null,
    );
    return {
      key: domain.key,
      label: domain.label,
      verifiedRank,
      claimedRank,
      status: capabilityStatus({ claimedRank, verifiedRank }),
      facets,
    };
  });
}

export function isValidRank(catalog: Catalog, code: string): boolean {
  return catalog.tiers.some((t) => t.code === code);
}

export function isValidFacet(catalog: Catalog, key: string): boolean {
  return catalog.facets.some((f) => f.key === key);
}
