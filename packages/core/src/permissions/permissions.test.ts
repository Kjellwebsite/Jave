import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, capabilitiesForRoles, ROLE_CAPABILITIES } from './capabilities';
import { highestRole, ROLES, roleRank } from './roles';
import { hasCapability, systemActor, anonymousActor, type UserActor } from './actor';

function actor(roles: UserActor['roles']): UserActor {
  return {
    kind: 'user',
    userId: 'u',
    discordId: '1',
    memberId: 'm',
    displayName: 'x',
    roles,
    standing: 'good',
    capabilities: capabilitiesForRoles(roles),
  };
}

describe('permission model', () => {
  it('orders roles by the JAVELIN hierarchy', () => {
    const ranks = ROLES.map((r) => r.rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(highestRole(['member', 'moderator', 'verified'])).toBe('moderator');
    expect(highestRole([])).toBeNull();
  });

  it('founder holds every capability', () => {
    expect(new Set(ROLE_CAPABILITIES.founder)).toEqual(new Set(CAPABILITY_KEYS));
  });

  it('staff capability sets are strictly nested', () => {
    const mod = new Set(ROLE_CAPABILITIES.moderator);
    const ops = new Set(ROLE_CAPABILITIES.operations);
    const core = new Set(ROLE_CAPABILITIES.core);
    for (const c of mod) expect(ops.has(c)).toBe(true);
    for (const c of ops) expect(core.has(c)).toBe(true);
  });

  it('members cannot perform staff actions (least privilege)', () => {
    const m = actor(['verified']);
    for (const cap of [
      'canModifyRanks',
      'canBanMembers',
      'canViewAuditLogs',
      'canManageSettings',
      'canViewApplications',
    ] as const) {
      expect(hasCapability(m, cap)).toBe(false);
    }
  });

  it('moderators cannot ban or change ranks', () => {
    const m = actor(['moderator']);
    expect(hasCapability(m, 'canModerate')).toBe(true);
    expect(hasCapability(m, 'canBanMembers')).toBe(false);
    expect(hasCapability(m, 'canModifyRanks')).toBe(false);
  });

  it('only core and founder can manage adversarial roles', () => {
    expect(hasCapability(actor(['operations']), 'canManageAdversarial')).toBe(false);
    expect(hasCapability(actor(['core']), 'canManageAdversarial')).toBe(true);
  });

  it('supporter is cosmetic only', () => {
    expect(ROLE_CAPABILITIES.supporter).toEqual([]);
  });

  it('system has everything, anonymous has nothing', () => {
    expect(hasCapability(systemActor('t'), 'canManageSettings')).toBe(true);
    expect(hasCapability(anonymousActor, 'canViewMembers')).toBe(false);
  });

  it('rank values are unique', () => {
    expect(new Set(ROLES.map((r) => roleRank(r.key))).size).toBe(ROLES.length);
  });
});
