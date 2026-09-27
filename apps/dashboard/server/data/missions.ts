import 'server-only';
import { achievements, can, loadCatalog, type missions, type ServiceContext } from '@jave/core';

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

/**
 * Achievements a mission can grant: the active catalog (mission staff are
 * achievement staff, so nothing is masked). The mission's current reward is
 * kept as an option even when it was deactivated since, so saving the form
 * never drops it silently.
 */
export async function rewardOptions(
  ctx: ServiceContext,
  current: missions.MissionReward | null = null,
): Promise<Option[]> {
  const catalog = await achievements.getAchievementCatalog(ctx);
  const options = catalog.flatMap((entry) =>
    entry.masked
      ? []
      : [
          {
            value: entry.key,
            label: `${entry.title} · ${entry.rarity}${entry.visibility === 'hidden' ? ' · hidden' : ''}`,
          },
        ],
  );
  if (current && !current.hidden && !options.some((option) => option.value === current.key)) {
    options.unshift({
      value: current.key,
      label: `${current.title} · ${current.rarity} · inactive`,
    });
  }
  return options;
}
