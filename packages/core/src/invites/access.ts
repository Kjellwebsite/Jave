import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, UnauthenticatedError } from '../kernel/errors';

/**
 * Gate for bot-fed data (invite mirror, join attribution). Only the system
 * actor — the bot's gateway listeners and the job worker — may write it; not
 * even founders can inject invite data by hand. Denials are audited durably.
 */
export async function requireSystemActor(
  ctx: ServiceContext,
  target: { type: string; id?: string | null },
): Promise<void> {
  if (ctx.actor.kind === 'system') return;
  if (ctx.actor.kind === 'anonymous') throw new UnauthenticatedError();
  await recordAudit(
    ctx,
    {
      action: 'access.denied',
      targetType: target.type,
      targetId: target.id ?? null,
      context: { requirement: 'system' },
      result: 'denied',
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit denial'));
  throw new ForbiddenError();
}
