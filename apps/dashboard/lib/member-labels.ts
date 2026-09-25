/** Human labels for member enums (shared by filters, tables and profiles). */
export const GUILD_STATUS_LABELS = {
  present: 'In guild',
  departed: 'Departed',
  never_joined: 'Never joined',
} as const;

export const STANDING_LABELS = {
  good: 'Good',
  restricted: 'Restricted',
  quarantined: 'Quarantined',
  banned: 'Banned',
} as const;

export const MEMBER_SORT_LABELS = {
  joined_desc: 'Newest first',
  joined_asc: 'Oldest first',
  name: 'Name',
} as const;

export const VISIBILITY_LABELS = {
  public: 'Public',
  members: 'Members only',
  staff: 'Staff only',
} as const;

export type GuildStatus = keyof typeof GUILD_STATUS_LABELS;
export type Standing = keyof typeof STANDING_LABELS;

export const STANDING_TONE = {
  good: 'neutral',
  restricted: 'warning',
  quarantined: 'warning',
  banned: 'danger',
} as const;

export const GUILD_STATUS_TONE = {
  present: 'success',
  departed: 'neutral',
  never_joined: 'neutral',
} as const;

export function optionsFrom<T extends Record<string, string>>(labels: T) {
  return (Object.entries(labels) as [keyof T & string, string][]).map(([value, label]) => ({
    value,
    label,
  }));
}
