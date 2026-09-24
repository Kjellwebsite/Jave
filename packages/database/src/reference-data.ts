import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { capabilityDomains, capabilityFacets, rankTiers } from './schema';

/**
 * Reference data required for referential integrity. Applied idempotently by
 * `pnpm db:migrate` and by the test harness. Adding a tier (e.g. S+ at ordinal
 * 75, SS at 80) is a data change: append it here and re-run migrate.
 */
export const RANK_TIERS = [
  {
    code: 'F',
    ordinal: 10,
    label: 'F',
    description: 'Foundational. Beginning to engage with the domain.',
  },
  { code: 'E', ordinal: 20, label: 'E', description: 'Emerging. Basic, inconsistent capability.' },
  { code: 'D', ordinal: 30, label: 'D', description: 'Developing. Reliable at simple tasks.' },
  {
    code: 'C',
    ordinal: 40,
    label: 'C',
    description: 'Competent. Independently effective on typical work.',
  },
  {
    code: 'B',
    ordinal: 50,
    label: 'B',
    description: 'Advanced. Strong, consistent, sought out by peers.',
  },
  {
    code: 'A',
    ordinal: 60,
    label: 'A',
    description: 'Exceptional. Top of peer group; produces standout work.',
  },
  {
    code: 'S',
    ordinal: 70,
    label: 'S',
    description: 'Singular. Rare, demonstrated excellence with evidence.',
  },
] as const;

export const CAPABILITY_DOMAINS = [
  { key: 'mind', label: 'Mind', ordinal: 1, description: 'Reasoning, knowledge and research.' },
  {
    key: 'create',
    label: 'Create',
    ordinal: 2,
    description: 'Technical, creative and project output.',
  },
  { key: 'body', label: 'Body', ordinal: 3, description: 'Physical capability.' },
  { key: 'life', label: 'Life', ordinal: 4, description: 'Business and execution.' },
  { key: 'bio', label: 'Bio', ordinal: 5, description: 'Self-optimization.' },
] as const;

export const CAPABILITY_FACETS = [
  {
    key: 'mind.reasoning',
    domainKey: 'mind',
    label: 'Reasoning',
    ordinal: 1,
    description: 'Logic, problem decomposition, judgement under uncertainty.',
  },
  {
    key: 'mind.knowledge',
    domainKey: 'mind',
    label: 'Knowledge',
    ordinal: 2,
    description: 'Depth and breadth of understanding.',
  },
  {
    key: 'mind.research',
    domainKey: 'mind',
    label: 'Research',
    ordinal: 3,
    description: 'Finding, evaluating and producing knowledge.',
  },
  {
    key: 'create.technical',
    domainKey: 'create',
    label: 'Technical',
    ordinal: 1,
    description: 'Engineering, programming, building systems.',
  },
  {
    key: 'create.creative',
    domainKey: 'create',
    label: 'Creative',
    ordinal: 2,
    description: 'Design, art, writing, media.',
  },
  {
    key: 'create.projects',
    domainKey: 'create',
    label: 'Projects',
    ordinal: 3,
    description: 'Shipping complete projects end to end.',
  },
  {
    key: 'body.physical',
    domainKey: 'body',
    label: 'Physical',
    ordinal: 1,
    description: 'Strength, endurance, skill, athletic performance.',
  },
  {
    key: 'life.business',
    domainKey: 'life',
    label: 'Business',
    ordinal: 1,
    description: 'Commercial judgement, ventures, negotiation.',
  },
  {
    key: 'life.execution',
    domainKey: 'life',
    label: 'Execution',
    ordinal: 2,
    description: 'Reliability, follow-through, operating under pressure.',
  },
  {
    key: 'bio.optimization',
    domainKey: 'bio',
    label: 'Optimization',
    ordinal: 1,
    description: 'Deliberate self-optimization: health, sleep, training, habits.',
  },
] as const;

export type RankCode = (typeof RANK_TIERS)[number]['code'];
export type DomainKey = (typeof CAPABILITY_DOMAINS)[number]['key'];
export type FacetKey = (typeof CAPABILITY_FACETS)[number]['key'];

export async function applyReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const tier of RANK_TIERS) {
      await tx
        .insert(rankTiers)
        .values(tier)
        .onConflictDoUpdate({
          target: rankTiers.code,
          set: { ordinal: tier.ordinal, label: tier.label, description: tier.description },
        });
    }
    for (const domain of CAPABILITY_DOMAINS) {
      await tx
        .insert(capabilityDomains)
        .values(domain)
        .onConflictDoUpdate({
          target: capabilityDomains.key,
          set: { label: domain.label, description: domain.description, ordinal: domain.ordinal },
        });
    }
    for (const facet of CAPABILITY_FACETS) {
      await tx
        .insert(capabilityFacets)
        .values(facet)
        .onConflictDoUpdate({
          target: capabilityFacets.key,
          set: {
            domainKey: facet.domainKey,
            label: facet.label,
            description: facet.description,
            ordinal: facet.ordinal,
            enabled: sql`${capabilityFacets.enabled}`,
          },
        });
    }
  });
}
