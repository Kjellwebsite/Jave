import { and, eq, sql } from 'drizzle-orm';
import { referralCodes } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import type { ServiceContext } from '../kernel/context';
import {
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { requireMember } from '../permissions/authorize';
import { grantRoleUnchecked } from '../identity/roles.service';
import { activeRoles, resolveUserActor } from '../identity/users.service';
import type { ApplicationRecord } from './repository';
import { isEligibleToApply } from './rules';

/**
 * Applicant self-service guard: a member in good standing. Quarantined,
 * restricted or banned members cannot start or submit applications.
 */
export function requireApplicant(ctx: ServiceContext): UserActor & { memberId: string } {
  const actor = requireMember(ctx);
  if (actor.standing !== 'good') {
    throw new ForbiddenError('Your account standing does not allow applying right now.');
  }
  return actor;
}

export function assertEligibleToApply(actor: UserActor): void {
  if (!isEligibleToApply(actor.roles)) {
    throw new InvalidStateError('You are already part of JAVELIN. No application needed.');
  }
}

/**
 * Staff can never act on their own application (review, assign, schedule,
 * decide or read the staff view). The attempt is audited durably, so call
 * this before opening a transaction.
 */
export async function assertNotOwnApplication(
  ctx: ServiceContext,
  app: Pick<ApplicationRecord, 'id' | 'userId'>,
  attempted: string,
): Promise<void> {
  if (ctx.actor.kind !== 'user' || ctx.actor.userId !== app.userId) return;
  await recordAudit(
    ctx,
    {
      action: 'application.self_action_blocked',
      targetType: 'application',
      targetId: app.id,
      result: 'denied',
      context: { attempted },
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit self action'));
  throw new ForbiddenError('You cannot act on your own application.');
}

/** A reviewer must currently hold canReviewApplications and be in good standing. */
export async function assertEligibleReviewer(
  ctx: ServiceContext,
  reviewerUserId: string,
): Promise<void> {
  const reviewer = await resolveUserActor(ctx, reviewerUserId).catch((error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  if (
    !reviewer ||
    reviewer.standing !== 'good' ||
    !reviewer.capabilities.has('canReviewApplications')
  ) {
    throw new ValidationError('That person cannot review applications.', [
      { path: 'reviewerUserId', message: 'not an eligible reviewer' },
    ]);
  }
}

/**
 * Resolve a referral code case-insensitively to its canonical form. It must
 * exist, be active, and not belong to the applicant.
 */
export async function resolveReferralCode(
  ctx: ServiceContext,
  code: string,
  applicantUserId: string,
): Promise<string> {
  const [row] = await ctx.db
    .select({ code: referralCodes.code, ownerUserId: referralCodes.ownerUserId })
    .from(referralCodes)
    .where(and(sql`lower(${referralCodes.code}) = lower(${code})`, eq(referralCodes.active, true)))
    // An exact-case match wins over a case-insensitive one.
    .orderBy(sql`${referralCodes.code} = ${code} desc`)
    .limit(1);
  if (!row) {
    throw new ValidationError('Referral code not found or no longer active.', [
      { path: 'referralCode', message: 'unknown or inactive referral code' },
    ]);
  }
  if (row.ownerUserId === applicantUserId) {
    throw new ValidationError('You cannot use your own referral code.', [
      { path: 'referralCode', message: 'self-referral' },
    ]);
  }
  return row.code;
}

/** APPLICANT → MEMBER when an application closes without acceptance. */
export async function revertApplicantRole(
  ctx: ServiceContext,
  memberId: string,
  reason: string,
): Promise<boolean> {
  const roles = await activeRoles(ctx, memberId);
  if (!roles.includes('applicant')) return false;
  return grantRoleUnchecked(ctx, { memberId, role: 'member', reason });
}
