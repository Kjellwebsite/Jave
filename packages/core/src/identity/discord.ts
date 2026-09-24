/** Discord-facing identity helpers that do not depend on discord.js. */

export interface DiscordProfile {
  discordId: string;
  username: string;
  displayName?: string | null;
  avatarHash?: string | null;
  isBot?: boolean;
}

export function avatarUrl(
  discordId: string,
  avatarHash: string | null | undefined,
  size = 256,
): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=${size}`;
  }
  const index = Number((BigInt(discordId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Derive a URL-safe profile handle candidate from a Discord username. */
export function handleFromUsername(username: string): string {
  const base = username
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 28);
  return base.length >= 2 ? base : `member-${base}`.slice(0, 28);
}

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
