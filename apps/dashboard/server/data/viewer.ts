import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { avatarUrl, type Capability, highestRole, type OrgRole } from '@jave/core';
import { members, userPreferences, users } from '@jave/database';
import type { UserContext } from '../context';

/** What the shell and pages need to know about the signed-in user. Serializable. */
export interface Viewer {
  userId: string;
  memberId: string | null;
  displayName: string;
  handle: string | null;
  avatarUrl: string;
  timeZone: string;
  roles: OrgRole[];
  primaryRole: OrgRole | null;
  capabilities: Capability[];
}

export const loadViewer = cache(async (ctx: UserContext): Promise<Viewer> => {
  const { actor } = ctx;
  const [row] = await ctx.db
    .select({
      discordId: users.discordId,
      avatarHash: users.avatarHash,
      handle: members.handle,
      timeZone: userPreferences.timezone,
    })
    .from(users)
    .leftJoin(members, eq(members.userId, users.id))
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.id, actor.userId));
  return {
    userId: actor.userId,
    memberId: actor.memberId,
    displayName: actor.displayName,
    handle: row?.handle ?? null,
    avatarUrl: avatarUrl(actor.discordId, row?.avatarHash ?? null, 64),
    timeZone: row?.timeZone ?? 'UTC',
    roles: [...actor.roles],
    primaryRole: highestRole(actor.roles),
    capabilities: [...actor.capabilities],
  };
});
