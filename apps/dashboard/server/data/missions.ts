import 'server-only';
import { achievements, can, listMembers, loadCatalog, type ServiceContext } from '@jave/core';

export interface Option {
  value: string;
  label: string;
}

/** Mission staff see drafts, archives, rosters and the review queue. */
export function isMissionStaff(ctx: ServiceContext): boolean {
  return can(ctx, 'canManageMissions') || can(ctx, 'canVerifyMissions');
}

/** Capability facets for the mission form: "CREATE · Technical". */
export async function facetOptions(ctx: ServiceContext): Promise<Option[]> {
  const catalog = await loadCatalog(ctx);
  const domains = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  return catalog.facets.map((facet) => ({
    value: facet.key,
    label: `${(domains.get(facet.domainKey) ?? facet.domainKey).toUpperCase()} · ${facet.label}`,
  }));
}

/** Facet key → label, for read-only views. */
export async function facetLabels(ctx: ServiceContext): Promise<Map<string, string>> {
  const catalog = await loadCatalog(ctx);
  return new Map(catalog.facets.map((facet) => [facet.key, facet.label]));
}

/** Active achievements a mission can grant. Mission staff are achievement staff: nothing is masked. */
export async function rewardOptions(ctx: ServiceContext): Promise<Option[]> {
  const catalog = await achievements.getAchievementCatalog(ctx);
  return catalog.flatMap((entry) =>
    entry.masked
      ? []
      : [
          {
            value: entry.key,
            label: `${entry.title} · ${entry.rarity}${entry.visibility === 'hidden' ? ' · hidden' : ''}`,
          },
        ],
  );
}

/** How many members the assign dialog offers at most (searchable client-side). */
export const ASSIGN_CANDIDATES_LIMIT = 100;

export interface AssignCandidate {
  memberId: string;
  displayName: string;
  handle: string;
}

/**
 * Members staff may assign: present in the guild and in good standing
 * (canViewMembers, which every mission manager holds). The mission service
 * re-checks each one and reports anyone it skips.
 */
export async function assignCandidates(
  ctx: ServiceContext,
  exclude: ReadonlySet<string>,
): Promise<AssignCandidate[]> {
  const page = await listMembers(ctx, {
    guildStatus: 'present',
    standing: 'good',
    sort: 'name',
    limit: ASSIGN_CANDIDATES_LIMIT,
  });
  return page.items
    .filter((member) => !exclude.has(member.id))
    .map((member) => ({
      memberId: member.id,
      displayName: member.displayName,
      handle: member.handle,
    }));
}
