/** A member as a picker lists them. Serializable: it crosses the Server Action boundary. */
export interface MemberOption {
  memberId: string;
  displayName: string;
  handle: string;
}

export type MemberSearchResult =
  { status: 'ok'; members: MemberOption[] } | { status: 'error'; message: string };

/** A picker's search: a Server Action bound to the capability of its form. */
export type MemberSearch = (query: string) => Promise<MemberSearchResult>;

/** Selection after toggling one member, capped at `max` (the newest pick is refused, not a random one). */
export function toggleSelection(
  selected: readonly MemberOption[],
  member: MemberOption,
  max: number,
): MemberOption[] {
  if (selected.some((entry) => entry.memberId === member.memberId))
    return selected.filter((entry) => entry.memberId !== member.memberId);
  if (selected.length >= max) return [...selected];
  return [...selected, member];
}
