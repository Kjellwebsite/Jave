import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import { DisabledError, ForbiddenError } from '../kernel/errors';
import { actorMemberId, type MemberStanding } from '../permissions/actor';
import { can } from '../permissions/authorize';
import type { OrgRole } from '../permissions/roles';
import { getSettings } from '../settings/settings.service';
import { ELIGIBLE_ROLES, LEAD_PRIORITY_ROLES } from './constants';
import { findParticipation, STAKE_STATUSES } from './repository';

/**
 * Discord callbacks and job specs are reserved for the bot's worker, which
 * runs with a system actor. A user can never report channel IDs or read
 * provisioning data through them.
 */
export function requireSystem(ctx: Pick<ServiceContext, 'actor'>): void {
  if (ctx.actor.kind !== 'system') throw new ForbiddenError('Reserved for JAVE internal jobs.');
}

export async function assertTrialsEnabled(ctx: ServiceContext): Promise<void> {
  if (!(await getSettings(ctx, 'trials')).enabled) throw new DisabledError('Trials');
}

export interface EligibilityInput {
  roles: readonly OrgRole[];
  standing: MemberStanding;
  guildStatus: 'present' | 'departed' | 'never_joined';
}

/** Why a member may not apply to trials, or null when they may. */
export function eligibilityProblem(input: EligibilityInput): string | null {
  if (input.standing !== 'good') return 'Your standing does not allow trial participation.';
  if (input.guildStatus !== 'present') return 'You must be in the JAVELIN server to take a trial.';
  if (!input.roles.some((role) => ELIGIBLE_ROLES.includes(role)))
    return 'Trials are open to TRIAL and VERIFIED members.';
  return null;
}

/** Holders of trial staff capabilities can read sealed briefs through the staff view. */
export function isTrialStaff(ctx: Pick<ServiceContext, 'actor'>): boolean {
  return can(ctx, 'canManageTrials') || can(ctx, 'canEvaluateTrials');
}

export function leadPriority(roles: readonly OrgRole[]): number {
  return roles.some((role) => LEAD_PRIORITY_ROLES.includes(role)) ? 1 : 0;
}

/** True when the actor has a stake in this trial (applied, selected or waitlisted). */
export async function hasStakeInTrial(ctx: ServiceContext, trialId: string): Promise<boolean> {
  const memberId = actorMemberId(ctx.actor);
  if (!memberId) return false;
  const row = await findParticipation(ctx, trialId, memberId);
  return row !== null && STAKE_STATUSES.includes(row.status);
}

/**
 * Conflict of interest: nobody operates, views staff data of, or evaluates a
 * trial they have a stake in — not even a founder. Blocks are audited
 * durably, so call this outside a transaction.
 */
export async function assertNoConflictOfInterest(
  ctx: ServiceContext,
  trialId: string,
  action: string,
): Promise<void> {
  if (!(await hasStakeInTrial(ctx, trialId))) return;
  await recordAudit(
    ctx,
    {
      action: 'trial.conflict_of_interest_blocked',
      targetType: 'trial',
      targetId: trialId,
      result: 'denied',
      context: { attempted: action },
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit trial conflict'));
  throw new ForbiddenError(`You are taking part in this trial, so you cannot ${action}.`);
}
