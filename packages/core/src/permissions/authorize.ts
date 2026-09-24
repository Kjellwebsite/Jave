import { recordAudit } from '../audit/audit.service';
import { ForbiddenError, UnauthenticatedError } from '../kernel/errors';
import type { ServiceContext } from '../kernel/context';
import { type Actor, hasCapability, type UserActor } from './actor';
import type { Capability } from './capabilities';

export function can(ctx: Pick<ServiceContext, 'actor'>, capability: Capability): boolean {
  return hasCapability(ctx.actor, capability);
}

/**
 * Throws ForbiddenError unless the actor holds `capability`. Denials are
 * written to the audit log outside any open transaction.
 */
export async function authorize(
  ctx: ServiceContext,
  capability: Capability,
  target?: { type: string; id?: string | null },
): Promise<void> {
  if (hasCapability(ctx.actor, capability)) return;
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  await recordAudit(
    ctx,
    {
      action: 'access.denied',
      targetType: target?.type,
      targetId: target?.id ?? null,
      context: { capability },
      result: 'denied',
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
  throw new ForbiddenError();
}

export function requireUser(ctx: Pick<ServiceContext, 'actor'>): UserActor {
  if (ctx.actor.kind !== 'user') throw new UnauthenticatedError();
  return ctx.actor;
}

export function requireMember(
  ctx: Pick<ServiceContext, 'actor'>,
): UserActor & { memberId: string } {
  const actor = requireUser(ctx);
  if (!actor.memberId) throw new ForbiddenError('You need a JAVELIN profile first. Run /start.');
  return actor as UserActor & { memberId: string };
}

/** True when the actor is the given member (self-service paths). */
export function isSelf(actor: Actor, memberId: string): boolean {
  return actor.kind === 'user' && actor.memberId === memberId;
}
