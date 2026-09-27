import { isStaffRole, type OrgRole } from '@jave/core';
import type { RoleSnapshot } from '../../discord/gateway';
import { elevatedPermissions } from './settings-catalog';

/**
 * The last check before JAVE hands out a Discord role. Mappings reach the
 * settings from two surfaces (the bot, which inspects Discord roles, and the
 * dashboard, which cannot), so role sync re-checks what only Discord knows at
 * the moment it acts:
 *
 * - `administrator` — JAVE never hands out Administrator, to anyone;
 * - `elevated` — a role with elevated permissions (Kick, Ban, Manage…) goes
 *   only to members who hold a staff JAVE role mapped to it. Staff mappings
 *   are founder-only (core `mayMapRole`), so elevated power reaches members
 *   only through a mapping a founder made;
 * - `managed` — integration roles cannot be assigned by anyone;
 * - `hierarchy` — a role at or above JAVE's highest role: Discord would refuse
 *   it. `/jave setup` reports it; RE-SYNC ROLES applies it once fixed.
 *
 * Roles Discord does not list are passed through: Discord refuses them itself.
 */
export type WithheldReason = 'administrator' | 'elevated' | 'managed' | 'hierarchy';

export interface WithheldRole {
  roleId: string;
  reason: WithheldReason;
}

export interface RoleScreen {
  allowed: string[];
  withheld: WithheldRole[];
}

export interface ScreenInput {
  /** The member's JAVE roles that entitle them to mapped Discord roles. */
  desired: readonly OrgRole[];
  mapping: Partial<Record<OrgRole, string>>;
  roles: readonly RoleSnapshot[];
  botHighestRolePosition: number;
}

function withholdReason(
  roleId: string,
  role: RoleSnapshot,
  input: ScreenInput,
): WithheldReason | null {
  if (role.managed) return 'managed';
  if (role.position >= input.botHighestRolePosition) return 'hierarchy';
  const elevated = elevatedPermissions(role);
  if (elevated.includes('Administrator')) return 'administrator';
  if (elevated.length === 0) return null;
  const viaStaff = input.desired.some(
    (jave) => isStaffRole(jave) && input.mapping[jave] === roleId,
  );
  return viaStaff ? null : 'elevated';
}

export function screenRoleAdds(add: readonly string[], input: ScreenInput): RoleScreen {
  const byId = new Map(input.roles.map((role) => [role.id, role]));
  const screen: RoleScreen = { allowed: [], withheld: [] };
  for (const roleId of add) {
    const role = byId.get(roleId);
    const reason = role ? withholdReason(roleId, role, input) : null;
    if (reason) screen.withheld.push({ roleId, reason });
    else screen.allowed.push(roleId);
  }
  return screen;
}
