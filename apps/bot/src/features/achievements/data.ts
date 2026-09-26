import {
  achievements,
  findMemberByDiscordId,
  getMemberById,
  isUuid,
  NotFoundError,
} from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import type { HeldAward } from './render';

/** The member a view is about: by Discord user (commands) or member id (buttons). */
export type MemberRef = { discordId: string } | { memberId: string };

/** Resolve a member id. Custom-id arguments are untrusted: malformed ids read as not found. */
export async function resolveMemberId(h: HandlerContext, ref: MemberRef): Promise<string> {
  if ('memberId' in ref) {
    if (!isUuid(ref.memberId)) throw new NotFoundError('JVLN profile');
    return ref.memberId;
  }
  const member = await findMemberByDiscordId(h.ctx, ref.discordId);
  if (!member) throw new NotFoundError('JVLN profile');
  return member.id;
}

/**
 * The member's active awards, as their profile shows them. Throws NOT_FOUND
 * when the viewer may not see the profile, so call it before rendering
 * anything else about the member.
 */
export async function heldAwards(h: HandlerContext, memberId: string): Promise<HeldAward[]> {
  const rows = await achievements.listMemberAchievements(h.ctx, { memberId });
  return rows.map((row) => ({
    key: row.key,
    title: row.title,
    summary: row.summary,
    rarity: row.rarity,
    visibility: row.visibility,
    verified: row.verified,
  }));
}

/** Display name for copy. Only call after the profile's visibility was checked. */
export async function memberName(h: HandlerContext, memberId: string): Promise<string> {
  return (await getMemberById(h.ctx, memberId)).displayName;
}
