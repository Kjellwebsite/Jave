import { and, eq, notInArray } from 'drizzle-orm';
import { trialParticipants, trials } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { hasCapability } from './actor';

/** Job types of the adversarial module (discord.adversarial.*, adversarial.sweep), for LIKE. */
export const ADVERSARIAL_JOB_PATTERN = '%adversarial.%';

/** Trials whose participants may still be the subject of an unrevealed role. */
const SETTLED_TRIAL_STATUSES = ['completed', 'cancelled'] as const;

/**
 * Whether the caller may see that adversarial records exist, in surfaces
 * shared with other staff (the audit log, the job queue): canManageAdversarial,
 * and no part in a trial that is still open. Staff who compete must not learn
 * whether their trial has a role. Internal actors see everything.
 */
export async function mayReadAdversarialRecords(ctx: ServiceContext): Promise<boolean> {
  if (ctx.actor.kind === 'system') return true;
  if (ctx.actor.kind !== 'user' || !hasCapability(ctx.actor, 'canManageAdversarial')) return false;
  if (!ctx.actor.memberId) return true;
  const [open] = await ctx.db
    .select({ id: trialParticipants.id })
    .from(trialParticipants)
    .innerJoin(trials, eq(trials.id, trialParticipants.trialId))
    .where(
      and(
        eq(trialParticipants.memberId, ctx.actor.memberId),
        notInArray(trials.status, [...SETTLED_TRIAL_STATUSES]),
      ),
    )
    .limit(1);
  return !open;
}
