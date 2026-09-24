import type { orgRole } from '@jave/database';

export type OrgRole = (typeof orgRole.enumValues)[number];

export interface RoleDefinition {
  key: OrgRole;
  label: string;
  /** Higher outranks lower. Used for assignment hierarchy. */
  rank: number;
  staff: boolean;
  description: string;
  /** Design-system treatment (see @jave/ui role tokens). */
  treatment:
    | 'holographic'
    | 'silver'
    | 'metallic'
    | 'steel'
    | 'white'
    | 'accent'
    | 'muted'
    | 'neutral'
    | 'special';
  /** Default Discord role colour (hex). Deliberately near-monochrome. */
  color: string;
}

/** JAVELIN role hierarchy. JAVE is the source of truth for these. */
export const ROLES: readonly RoleDefinition[] = [
  {
    key: 'founder',
    label: 'Founder',
    rank: 100,
    staff: true,
    treatment: 'holographic',
    color: '#F4F5F7',
    description: 'Founders of JAVELIN. Full authority.',
  },
  {
    key: 'core',
    label: 'Core',
    rank: 90,
    staff: true,
    treatment: 'silver',
    color: '#E8EAED',
    description: 'Core team. Runs the organization.',
  },
  {
    key: 'operations',
    label: 'Operations',
    rank: 80,
    staff: true,
    treatment: 'metallic',
    color: '#B8BDC3',
    description: 'Runs trials, missions, events and reviews.',
  },
  {
    key: 'moderator',
    label: 'Moderator',
    rank: 70,
    staff: true,
    treatment: 'steel',
    color: '#737981',
    description: 'Keeps the community safe.',
  },
  {
    key: 'verified',
    label: 'Verified',
    rank: 50,
    staff: false,
    treatment: 'white',
    color: '#FFFFFF',
    description: 'Verified JAVELIN member.',
  },
  {
    key: 'trial',
    label: 'Trial',
    rank: 40,
    staff: false,
    treatment: 'accent',
    color: '#9FB4C7',
    description: 'Accepted; proving themselves.',
  },
  {
    key: 'applicant',
    label: 'Applicant',
    rank: 20,
    staff: false,
    treatment: 'muted',
    color: '#8A8F96',
    description: 'Application in progress.',
  },
  {
    key: 'member',
    label: 'Member',
    rank: 10,
    staff: false,
    treatment: 'neutral',
    color: '#6B7077',
    description: 'Community member.',
  },
  {
    key: 'supporter',
    label: 'Supporter',
    rank: 5,
    staff: false,
    treatment: 'special',
    color: '#C9B98F',
    description: 'Supports JAVELIN. Cosmetic.',
  },
] as const;

export const ROLE_KEYS = ROLES.map((role) => role.key);

const BY_KEY = new Map(ROLES.map((role) => [role.key, role]));

export function getRole(key: OrgRole): RoleDefinition {
  const role = BY_KEY.get(key);
  if (!role) throw new Error(`unknown role ${key}`);
  return role;
}

export function roleRank(key: OrgRole): number {
  return getRole(key).rank;
}

/** Highest-ranked role among a set (the member's primary visual role). */
export function highestRole(roles: readonly OrgRole[]): OrgRole | null {
  let best: OrgRole | null = null;
  for (const role of roles) {
    if (!best || roleRank(role) > roleRank(best)) best = role;
  }
  return best;
}

export function isStaffRole(key: OrgRole): boolean {
  return getRole(key).staff;
}

/** Roles that represent organizational progression; a member holds at most one. */
export const PROGRESSION_ROLES: readonly OrgRole[] = ['verified', 'trial', 'applicant', 'member'];
