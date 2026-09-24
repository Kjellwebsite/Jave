import { and, eq, isNull } from 'drizzle-orm';
import { memberRoles } from '@jave/database';
import type { ServiceContext } from '../../kernel/context';
import { ConflictError, InvalidStateError } from '../../kernel/errors';
import { grantRoleUnchecked, revokeRoleUnchecked } from '../../identity/roles.service';
import { activeRoles } from '../../identity/users.service';
import { isStaffRole, type OrgRole, PROGRESSION_ROLES } from '../../permissions/roles';
import { expectOutcome } from '../repository';
import { targetKeys } from '../rules';
import type { VerificationStrategy } from '../types';
import { expectTarget } from './shared';

/**
 * Identity rule:
 *  - Eligible: members holding TRIAL, APPLICANT or MEMBER (the non-verified progression roles).
 *  - Already VERIFIED: a request is refused; an approval that finds VERIFIED
 *    already granted records `granted: false` and changes nothing.
 *  - Staff (FOUNDER, CORE, OPERATIONS, MODERATOR) are verified-equivalent:
 *    requests are refused and approvals change nothing.
 *  - Anyone else (e.g. SUPPORTER only) is ineligible.
 * Approval grants VERIFIED (progression roles are exclusive, so the previous
 * one is retired). Revocation revokes VERIFIED only while the active grant is
 * the one this approval made, then restores the recorded previous progression
 * role (MEMBER if none was recorded) unless the member holds a staff role or
 * another progression role by then.
 */
export const IDENTITY_ELIGIBLE_ROLES: readonly OrgRole[] = ['trial', 'applicant', 'member'];

const VERIFIED_ROLE: OrgRole = 'verified';
const FALLBACK_ROLE: OrgRole = 'member';

type IdentityStanding = 'verified' | 'staff' | 'eligible' | 'ineligible';

export function classifyIdentityRoles(roles: readonly OrgRole[]): IdentityStanding {
  if (roles.some(isStaffRole)) return 'staff';
  if (roles.includes(VERIFIED_ROLE)) return 'verified';
  if (roles.some((role) => IDENTITY_ELIGIBLE_ROLES.includes(role))) return 'eligible';
  return 'ineligible';
}

function eligibleRoleHeld(roles: readonly OrgRole[]): OrgRole | null {
  return IDENTITY_ELIGIBLE_ROLES.find((role) => roles.includes(role)) ?? null;
}

function isEligibleRole(value: string | null): value is OrgRole {
  return value !== null && (IDENTITY_ELIGIBLE_ROLES as readonly string[]).includes(value);
}

/** The member_roles reason written by an approval; revocation only undoes that exact grant. */
export function identityGrantReason(reference: string): string {
  return `${reference} identity verification approved`;
}

/** True while the member's active VERIFIED role is the one this verification granted. */
async function holdsGrantFrom(
  tx: ServiceContext,
  memberId: string,
  reference: string,
): Promise<boolean> {
  const [row] = await tx.db
    .select({ reason: memberRoles.reason })
    .from(memberRoles)
    .where(
      and(
        eq(memberRoles.memberId, memberId),
        eq(memberRoles.role, VERIFIED_ROLE),
        isNull(memberRoles.revokedAt),
      ),
    );
  return row?.reason === identityGrantReason(reference);
}

/** Staff and members with a progression role need nothing restored. */
async function needsBaselineRole(tx: ServiceContext, memberId: string): Promise<boolean> {
  const roles = await activeRoles(tx, memberId);
  return !roles.some((role) => isStaffRole(role) || PROGRESSION_ROLES.includes(role));
}

export const identityStrategy: VerificationStrategy = {
  type: 'identity',
  deciderCapabilities: [],
  singleApproval: false,

  async resolveTarget(ctx, subject, target) {
    expectTarget(target, 'identity');
    const standing = classifyIdentityRoles(await activeRoles(ctx, subject.id));
    if (standing === 'verified') throw new ConflictError('Already VERIFIED.');
    if (standing === 'staff')
      throw new InvalidStateError('Staff roles are verified-equivalent. No verification needed.');
    if (standing === 'ineligible')
      throw new InvalidStateError(
        'Identity verification requires the MEMBER, APPLICANT or TRIAL role.',
      );
    return {
      targetType: 'member',
      targetId: subject.id,
      targetKey: targetKeys.identity(subject.id),
      targetLabel: `@${subject.handle}`,
      facetKey: null,
      requestedRank: null,
      defaultClaim: 'Identity confirmed within JAVELIN.',
    };
  },

  async approve(tx, verification, input) {
    const roles = await activeRoles(tx, verification.subjectMemberId);
    const standing = classifyIdentityRoles(roles);
    if (standing === 'ineligible')
      throw new InvalidStateError('The member no longer holds a role eligible for VERIFIED.');
    if (standing !== 'eligible') {
      return {
        outcome: { kind: 'role', granted: false, previousRole: null },
        grantedRank: null,
        subjectNotified: false,
      };
    }
    const previousRole = eligibleRoleHeld(roles);
    await grantRoleUnchecked(tx, {
      memberId: verification.subjectMemberId,
      role: VERIFIED_ROLE,
      reason: identityGrantReason(input.reference),
    });
    return {
      outcome: { kind: 'role', granted: true, previousRole },
      grantedRank: null,
      subjectNotified: false,
    };
  },

  async revoke(tx, verification, stored, input) {
    const outcome = expectOutcome(stored, 'role');
    if (!outcome.granted)
      return {
        reverted: false,
        detail: 'role_not_granted_by_verification',
        subjectNotified: false,
      };
    // VERIFIED revoked (or re-granted by someone else) since approval: leave it.
    if (!(await holdsGrantFrom(tx, verification.subjectMemberId, input.reference)))
      return { reverted: false, detail: 'verified_role_changed_since', subjectNotified: false };
    await revokeRoleUnchecked(tx, {
      memberId: verification.subjectMemberId,
      role: VERIFIED_ROLE,
      reason: `${input.reference} revoked: ${input.reason}`,
    });
    if (!(await needsBaselineRole(tx, verification.subjectMemberId)))
      return { reverted: true, detail: 'verified_revoked', subjectNotified: false };
    const restore = isEligibleRole(outcome.previousRole) ? outcome.previousRole : FALLBACK_ROLE;
    await grantRoleUnchecked(tx, {
      memberId: verification.subjectMemberId,
      role: restore,
      reason: `${input.reference} revoked: previous role restored`,
    });
    return {
      reverted: true,
      detail: `verified_revoked_${restore}_restored`,
      subjectNotified: false,
    };
  },
};
