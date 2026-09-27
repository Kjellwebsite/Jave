import 'server-only';
import { can, getSettings, loadCatalog, type ServiceContext, trials } from '@jave/core';
import type { FacetOption } from '@/components/trials/trial-form';
import { categoryLabel } from '@/lib/trial-labels';

export interface TrialFormOptions {
  categories: { value: string; label: string }[];
  facets: FacetOption[];
  defaultTeamSize: number;
  /** The viewer holds canManageAdversarial and the global switch is on. */
  adversarialAvailable: boolean;
}

/** Choices shared by the trial and template forms (catalog, settings, capability). */
export async function loadTrialFormOptions(ctx: ServiceContext): Promise<TrialFormOptions> {
  const [catalog, settings] = await Promise.all([loadCatalog(ctx), getSettings(ctx, 'trials')]);
  const domainLabel = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  const domainOrder = new Map(catalog.domains.map((domain) => [domain.key, domain.ordinal]));
  // Grouped by domain (Mind, Create, Body, …), then in catalog order within it.
  const facets = [...catalog.facets].sort(
    (a, b) =>
      (domainOrder.get(a.domainKey) ?? 0) - (domainOrder.get(b.domainKey) ?? 0) ||
      a.ordinal - b.ordinal,
  );
  return {
    categories: trials.TRIAL_CATEGORIES.map((category) => ({
      value: category,
      label: categoryLabel(category),
    })),
    facets: facets.map((facet) => ({
      key: facet.key,
      label: facet.label,
      domain: domainLabel.get(facet.domainKey) ?? facet.domainKey,
    })),
    defaultTeamSize: settings.defaultTeamSize,
    adversarialAvailable: can(ctx, 'canManageAdversarial') && settings.adversarialEnabled,
  };
}
