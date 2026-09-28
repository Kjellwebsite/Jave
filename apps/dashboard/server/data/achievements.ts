import 'server-only';
import { achievements, can, type ServiceContext } from '@jave/core';
import {
  type AchievementOption,
  type HolderShare,
  ruleEventLabel,
  type RuleEventOption,
} from '@/lib/achievement-labels';

/** The criteria builder's outcomes: exactly the core allow-list, first steps flagged. */
export function ruleEventOptions(): RuleEventOption[] {
  return achievements.ACHIEVEMENT_EVENT_TYPES.map((event) => ({
    value: event,
    label: ruleEventLabel(event),
    firstStep: achievements.FIRST_STEP_ONLY_EVENTS.has(event),
  }));
}

export interface RarityOverview {
  /** Present in the guild, not deleted, not banned: the population of every share. */
  activeMembers: number;
  /** Active awards across the active catalog. */
  unlocks: number;
  /** By key; definitions masked for the viewer are left out. */
  byKey: ReadonlyMap<string, HolderShare>;
}

/** Holders and share of active members per achievement (canViewMembers), or null. */
export async function loadRarity(ctx: ServiceContext): Promise<RarityOverview | null> {
  // Checking first keeps a refusal out of the audit log for members without the capability.
  if (!can(ctx, 'canViewMembers')) return null;
  const stats = await achievements.getAchievementRarityStats(ctx);
  const byKey = new Map<string, HolderShare>();
  let unlocks = 0;
  for (const stat of stats.achievements) {
    unlocks += stat.holders;
    if (!stat.masked) byKey.set(stat.key, { holders: stat.holders, percent: stat.percent });
  }
  return { activeMembers: stats.activeMembers, unlocks, byKey };
}

/** Active achievements staff may award by hand (achievement staff see hidden ones unmasked). */
export async function awardOptions(ctx: ServiceContext): Promise<AchievementOption[]> {
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
