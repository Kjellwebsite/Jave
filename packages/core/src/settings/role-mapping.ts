import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import type { Actor } from '../permissions/actor';
import { highestRole, isStaffRole, type OrgRole, ROLE_KEYS, roleRank } from '../permissions/roles';
import type { Settings } from './schemas';

/**
 * Write-time rules of the `roles` section. They are deliberately not part of
 * the zod schema: the schema also parses what is already stored, and a rule
 * added later must never turn an existing configuration into "invalid" (which
 * would read back as defaults and silently unmap every role).
 */

type RoleSettings = Settings<'roles'>;

/**
 * Whether `actor` may change which Discord role follows the JAVE `role`. A
 * mapped Discord role reaches every holder of the JAVE role, so changing a
 * mapping is as strong as granting the role:
 * - founders (and system processes) may change every mapping;
 * - staff mappings are founder-only. They are the only mappings role sync lets
 *   carry elevated Discord permissions, so nobody else can route moderation
 *   or administration power to a role they are able to hand out;
 * - everyone else changes only roles strictly below their own highest role.
 */
export function mayMapRole(actor: Actor, role: OrgRole): boolean {
  if (actor.kind === 'system') return true;
  if (actor.kind !== 'user') return false;
  const top = highestRole(actor.roles);
  if (top === 'founder') return true;
  if (!top || isStaffRole(role)) return false;
  return roleRank(role) < roleRank(top);
}

export function assertMayMapRole(ctx: Pick<ServiceContext, 'actor'>, role: OrgRole): void {
  if (mayMapRole(ctx.actor, role)) return;
  throw new ForbiddenError(
    isStaffRole(role)
      ? 'Only a founder can map staff roles to Discord.'
      : 'Only roles below your own can be mapped by you.',
  );
}

/** JAVE roles whose Discord role is also the quarantine role. */
export function quarantineConflicts(roles: RoleSettings): OrgRole[] {
  const quarantine = roles.quarantineRoleId;
  if (!quarantine) return [];
  return ROLE_KEYS.filter((role) => roles.discordRoleIds[role] === quarantine);
}

/**
 * Discord roles JAVE managed before a write and no longer manages after it:
 * mapped before, and neither mapped nor the quarantine role now. Role sync
 * only ever removes roles that are currently mapped, so these are retired
 * explicitly (see `scheduleRoleResyncForAll`).
 */
export function retiredRoleIds(before: RoleSettings, after: RoleSettings): string[] {
  const kept = new Set<string>(Object.values(after.discordRoleIds).filter(isPresent));
  if (after.quarantineRoleId) kept.add(after.quarantineRoleId);
  const previous = Object.values(before.discordRoleIds).filter(isPresent);
  return [...new Set(previous.filter((id) => !kept.has(id)))];
}

function isPresent(id: string | undefined): id is string {
  return Boolean(id);
}

/**
 * Check a `roles` write (`current` → `next`, both schema-valid):
 * - every JAVE role whose mapping changes must be one the actor may map;
 * - the write may not introduce a quarantine role that is also a mapped role
 *   (quarantine strips every mapped role; it would strip its own). A conflict
 *   already stored is left for the admin to resolve and reported by
 *   `/jave setup`, so it never blocks unrelated changes.
 */
export function assertRoleMappingWrite(
  ctx: Pick<ServiceContext, 'actor'>,
  current: RoleSettings,
  next: RoleSettings,
): void {
  for (const role of ROLE_KEYS) {
    if (current.discordRoleIds[role] !== next.discordRoleIds[role]) assertMayMapRole(ctx, role);
  }
  const existing = new Set(
    current.quarantineRoleId === next.quarantineRoleId ? quarantineConflicts(current) : [],
  );
  const introduced = quarantineConflicts(next).filter((role) => !existing.has(role));
  if (introduced.length > 0) {
    const message = `The quarantine role is mapped to ${introduced.map((r) => r.toUpperCase()).join(', ')}; quarantine needs its own role.`;
    throw new ValidationError(message, [{ path: 'quarantineRoleId', message }]);
  }
}
