import type { ServiceContext } from '../kernel/context';
import { ForbiddenError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { requireMember } from '../permissions/authorize';

export type ActiveMember = UserActor & { memberId: string };

/**
 * A member in good standing. Restricted, quarantined and banned members can
 * read but not take part (RSVP, check in, play).
 */
export function requireActiveMember(ctx: Pick<ServiceContext, 'actor'>): ActiveMember {
  const actor = requireMember(ctx);
  if (actor.standing !== 'good') {
    throw new ForbiddenError('Your account standing does not allow this right now.');
  }
  return actor;
}

/** Read access for org-internal listings: any member, or the system itself. */
export function requireViewer(ctx: Pick<ServiceContext, 'actor'>): void {
  if (ctx.actor.kind === 'system') return;
  requireMember(ctx);
}

/**
 * Callbacks that report Discord side-effect results are called by the bot's
 * worker, which always runs as the system actor. No user may call them.
 */
export function requireSystemActor(ctx: Pick<ServiceContext, 'actor'>): void {
  if (ctx.actor.kind !== 'system') {
    throw new ForbiddenError('Only the JAVE worker can report Discord results.');
  }
}
