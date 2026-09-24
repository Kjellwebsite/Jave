import type { Capability } from './capabilities';
import type { OrgRole } from './roles';

export type MemberStanding = 'good' | 'restricted' | 'quarantined' | 'banned';

export interface UserActor {
  kind: 'user';
  userId: string;
  discordId: string;
  memberId: string | null;
  displayName: string;
  roles: readonly OrgRole[];
  standing: MemberStanding;
  capabilities: ReadonlySet<Capability>;
}

/** Internal processes: jobs, schedulers, the event dispatcher. Holds every capability. */
export interface SystemActor {
  kind: 'system';
  reason: string;
}

/** Inbound integrations (webhooks). Holds only the capabilities granted explicitly. */
export interface IntegrationActor {
  kind: 'integration';
  integrationId: string;
  provider: string;
  capabilities: ReadonlySet<Capability>;
}

/** Unauthenticated visitor (public profile pages). */
export interface AnonymousActor {
  kind: 'anonymous';
}

export type Actor = UserActor | SystemActor | IntegrationActor | AnonymousActor;

export const systemActor = (reason: string): SystemActor => ({ kind: 'system', reason });
export const anonymousActor: AnonymousActor = { kind: 'anonymous' };

export function actorUserId(actor: Actor): string | null {
  return actor.kind === 'user' ? actor.userId : null;
}

export function actorMemberId(actor: Actor): string | null {
  return actor.kind === 'user' ? actor.memberId : null;
}

export function hasCapability(actor: Actor, capability: Capability): boolean {
  switch (actor.kind) {
    case 'system':
      return true;
    case 'user':
    case 'integration':
      return actor.capabilities.has(capability);
    case 'anonymous':
      return false;
  }
}

export function isStaff(actor: Actor): boolean {
  return (
    actor.kind === 'system' ||
    (actor.kind === 'user' &&
      actor.roles.some((r) => ['founder', 'core', 'operations', 'moderator'].includes(r)))
  );
}
