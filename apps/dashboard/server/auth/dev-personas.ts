/**
 * DEV LOGIN PERSONAS — MOCK / DEVELOPMENT ONLY.
 *
 * Deterministic fake Discord users (ids 100000000000000001…6), one per role
 * the dashboard must be exercised with. Used by the dev login (guarded in
 * `dev-auth.ts`) and by the end-to-end seed. Never reachable in production.
 */
import {
  activeRoles,
  ensureMember,
  grantRoleUnchecked,
  type OrgRole,
  type ServiceContext,
  upsertDiscordUser,
  type UserRecord,
} from '@jave/core';

export interface DevPersona {
  key: string;
  label: string;
  role: OrgRole;
  discordId: string;
  username: string;
  displayName: string;
  description: string;
}

export const DEV_PERSONAS: readonly DevPersona[] = [
  {
    key: 'founder',
    label: 'Founder',
    role: 'founder',
    discordId: '100000000000000001',
    username: 'dev_founder',
    displayName: 'Dev Founder',
    description: 'Full authority.',
  },
  {
    key: 'core',
    label: 'Core',
    role: 'core',
    discordId: '100000000000000002',
    username: 'dev_core',
    displayName: 'Dev Core',
    description: 'Roles, ranks, settings, audit.',
  },
  {
    key: 'operations',
    label: 'Operations',
    role: 'operations',
    discordId: '100000000000000003',
    username: 'dev_operations',
    displayName: 'Dev Operations',
    description: 'Members, trials, reviews. Settings read-only.',
  },
  {
    key: 'moderator',
    label: 'Moderator',
    role: 'moderator',
    discordId: '100000000000000004',
    username: 'dev_moderator',
    displayName: 'Dev Moderator',
    description: 'Safety and tickets.',
  },
  {
    key: 'verified',
    label: 'Verified',
    role: 'verified',
    discordId: '100000000000000005',
    username: 'dev_verified',
    displayName: 'Dev Verified',
    description: 'Verified member. No staff access.',
  },
  {
    key: 'member',
    label: 'Member',
    role: 'member',
    discordId: '100000000000000006',
    username: 'dev_member',
    displayName: 'Dev Member',
    description: 'Community member. No staff access.',
  },
];

export function findDevPersona(key: string): DevPersona | null {
  return DEV_PERSONAS.find((persona) => persona.key === key) ?? null;
}

/**
 * Creates (or refreshes) the persona's fake Discord user and member, and
 * grants its role. Idempotent. `ctx` must carry a system actor.
 */
export async function provisionDevPersona(
  ctx: ServiceContext,
  persona: DevPersona,
): Promise<UserRecord> {
  const user = await upsertDiscordUser(ctx, {
    discordId: persona.discordId,
    username: persona.username,
    displayName: persona.displayName,
  });
  const member = await ensureMember(ctx, user, { inGuild: true });
  const roles = await activeRoles(ctx, member.id);
  if (!roles.includes(persona.role)) {
    await grantRoleUnchecked(ctx, {
      memberId: member.id,
      role: persona.role,
      reason: 'dev persona (MOCK / DEVELOPMENT ONLY)',
    });
  }
  return user;
}
