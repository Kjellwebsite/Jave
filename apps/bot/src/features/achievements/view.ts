import { achievements, can, getMemberById, isSelf } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { heldAwards } from './data';
import { buildCatalogLines, type HolderShares, renderCatalogPanel } from './render';

/** Share of active members holding each achievement, as the viewer may see it. */
async function holderShares(h: HandlerContext): Promise<HolderShares> {
  const byKey = new Map<string, number>();
  const bySlot = new Map<number, number>();
  // Rarity stats need canViewMembers; checking first keeps refusals out of the audit log.
  if (can(h.ctx, 'canViewMembers')) {
    const stats = await achievements.getAchievementRarityStats(h.ctx);
    stats.achievements.forEach((stat, slot) => {
      // Slots cover every entry: a public post masks definitions the viewer may see.
      bySlot.set(slot, stat.percent);
      if (!stat.masked) byKey.set(stat.key, stat.percent);
    });
  }
  return { byKey, bySlot };
}

/**
 * The catalog seen through one member: their unlocked achievements marked,
 * the rest locked, hidden ones masked unless the member (or a staff viewer)
 * may see them. A shared (public) view masks every hidden achievement the
 * member has not unlocked, whatever the viewer may see. Visibility of the
 * member is checked before anything renders.
 */
export async function memberCatalogPayload(
  h: HandlerContext,
  memberId: string,
  options: { page: number; share: boolean },
): Promise<ReplyPayload> {
  const held = await heldAwards(h, memberId);
  const [catalog, member, shares] = await Promise.all([
    achievements.getAchievementCatalog(h.ctx),
    getMemberById(h.ctx, memberId),
    holderShares(h),
  ]);
  // Staff-only profiles are never posted publicly, even when the viewer may see them.
  const shared = options.share && member.profileVisibility !== 'staff';
  const staff =
    can(h.ctx, 'canAwardAchievements') && !isSelf(h.ctx.actor, memberId)
      ? { canRevoke: held.length > 0, canVerify: held.some((award) => !award.verified) }
      : null;
  return renderCatalogPanel({
    memberId,
    memberName: member.displayName,
    lines: buildCatalogLines(catalog, held, shares, { publicView: shared }),
    page: options.page,
    staff,
    shared,
  });
}
