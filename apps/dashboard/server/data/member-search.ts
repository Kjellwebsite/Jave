import 'server-only';
import {
  authorize,
  type Capability,
  isJaveError,
  listMembers,
  newErrorId,
  type ServiceContext,
} from '@jave/core';
import type { MemberOption, MemberSearchResult } from '@/lib/member-search';
import { getRequestContext, isUserContext } from '../context';
import { isTrustedMutationRequest } from '../request';

/** Matches a picker shows at once; typing narrows them. */
export const MEMBER_SEARCH_LIMIT = 20;
/** Longest query sent to the directory search (the service caps it too). */
export const MEMBER_SEARCH_MAX = 64;

/**
 * Members present in the guild whose name or handle matches, first by name.
 * Directory privacy applies (listMembers): profiles the viewer may not see
 * never appear.
 */
export async function searchPresentMembers(
  ctx: ServiceContext,
  query: string,
): Promise<MemberOption[]> {
  const search = query.trim().slice(0, MEMBER_SEARCH_MAX);
  const page = await listMembers(ctx, {
    search: search === '' ? undefined : search,
    guildStatus: 'present',
    sort: 'name',
    limit: MEMBER_SEARCH_LIMIT,
  });
  return page.items.map((member) => ({
    memberId: member.id,
    displayName: member.displayName,
    handle: member.handle,
  }));
}

/**
 * The envelope of a picker's search Server Action: same-origin request, live
 * session, the capability of the form the picker sits in (least privilege:
 * only staff who can use the form may search from it), then the directory.
 * Failures come back as a calm message, unexpected ones with a reference.
 */
export async function runMemberSearch(
  capability: Capability,
  query: unknown,
): Promise<MemberSearchResult> {
  if (!(await isTrustedMutationRequest()))
    return { status: 'error', message: 'Request origin rejected.' };
  const { ctx } = await getRequestContext();
  if (!isUserContext(ctx))
    return { status: 'error', message: 'Your session has ended. Sign in again.' };
  try {
    await authorize(ctx, capability);
    const members = await searchPresentMembers(ctx, typeof query === 'string' ? query : '');
    return { status: 'ok', members };
  } catch (error) {
    if (isJaveError(error)) return { status: 'error', message: error.userMessage };
    const reference = newErrorId();
    ctx.logger.error({ err: error, reference, capability }, 'member search failed');
    return { status: 'error', message: `Search failed. Reference ${reference}.` };
  }
}
