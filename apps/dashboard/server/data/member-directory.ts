import 'server-only';
import type { z } from 'zod';
import {
  listMembers,
  type listMembersSchema,
  type MemberListItem,
  type Page,
  type ServiceContext,
  viewsPrivateProfiles,
} from '@jave/core';

export type DirectoryQuery = z.input<typeof listMembersSchema>;

/** A directory row as the viewer may see it. Moderation standing is staff-only (null otherwise). */
export type DirectoryMember = MemberListItem;

export interface MemberDirectory {
  page: Page<DirectoryMember>;
  /** Staff view (canViewPrivateProfiles): standing, the standing filter and staff-only profiles. */
  staffView: boolean;
}

/**
 * The member directory. Core `listMembers` applies the same privacy rules as
 * a member's profile: staff (canViewPrivateProfiles) see everyone with their
 * standing; everyone else never sees or filters by standing and lists only
 * members whose profile they could open (never banned members or staff-only
 * profiles; their own row always). canViewMembers is required.
 */
export async function loadMemberDirectory(
  ctx: ServiceContext,
  query: DirectoryQuery,
): Promise<MemberDirectory> {
  return { page: await listMembers(ctx, query), staffView: viewsPrivateProfiles(ctx) };
}
