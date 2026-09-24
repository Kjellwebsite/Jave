import type { ServiceContext } from '../kernel/context';
import { ForbiddenError, InvalidStateError } from '../kernel/errors';
import type { MemberRecord } from '../identity/users.service';
import { recordAudit } from '../audit/audit.service';
import { actorUserId } from '../permissions/actor';
import { authorize, isSelf } from '../permissions/authorize';
import { verificationReference, verifierConflict } from './rules';
import type { LoadedVerification, VerificationStrategy } from './types';

async function auditBlocked(
  ctx: ServiceContext,
  verification: LoadedVerification,
  action: string,
  attempted: string,
): Promise<void> {
  await recordAudit(
    ctx,
    {
      action,
      targetType: 'verification',
      targetId: verification.id,
      result: 'denied',
      context: {
        reference: verificationReference(verification.number),
        type: verification.type,
        subjectMemberId: verification.subjectMemberId,
        attempted,
      },
    },
    { durable: true },
  ).catch((error: unknown) => ctx.logger.error({ err: error }, 'failed to audit blocked action'));
}

/** Nobody decides, reviews or revokes a verification about themselves. Audited durably. */
export async function assertNotSubject(
  ctx: ServiceContext,
  verification: LoadedVerification,
  attempted: string,
): Promise<void> {
  const self =
    isSelf(ctx.actor, verification.subjectMemberId) ||
    actorUserId(ctx.actor) === verification.subjectUserId;
  if (!self) return;
  await auditBlocked(ctx, verification, 'verification.self_decision_blocked', attempted);
  throw new ForbiddenError('You cannot verify your own request. Another verifier must decide it.');
}

/**
 * Two-person rule for staff-opened requests: whoever opened a verification on
 * someone else's behalf cannot also review or decide it. Audited durably.
 */
export async function assertNotStaffRequester(
  ctx: ServiceContext,
  verification: LoadedVerification,
  attempted: string,
): Promise<void> {
  const conflict = verifierConflict({
    verifierUserId: actorUserId(ctx.actor),
    subjectUserId: verification.subjectUserId,
    requestedByUserId: verification.requestedByUserId,
  });
  if (conflict !== 'requester') return;
  await auditBlocked(ctx, verification, 'verification.two_person_blocked', attempted);
  throw new ForbiddenError(
    'You opened this request for someone else. A second verifier must decide it.',
  );
}

/** Type-specific capabilities (e.g. canModifyRanks for skill). Denials are audited by authorize(). */
export async function authorizeStrategy(
  ctx: ServiceContext,
  verification: LoadedVerification,
  strategy: VerificationStrategy,
): Promise<void> {
  for (const capability of strategy.deciderCapabilities) {
    await authorize(ctx, capability, { type: 'verification', id: verification.id });
  }
}

/** When a verifier is assigned, only that verifier may review or decide. */
export function assertAssignee(ctx: ServiceContext, verification: LoadedVerification): void {
  const assigned = verification.assignedVerifierUserId;
  if (assigned && assigned !== actorUserId(ctx.actor))
    throw new ForbiddenError(
      'This verification is assigned to another verifier. Reassign it first.',
    );
}

/** All reviewer checks, run before any transaction opens (durable audits need rootDb). */
export async function assertReviewer(
  ctx: ServiceContext,
  verification: LoadedVerification,
  strategy: VerificationStrategy,
  attempted: string,
): Promise<void> {
  await assertNotSubject(ctx, verification, attempted);
  await assertNotStaffRequester(ctx, verification, attempted);
  await authorizeStrategy(ctx, verification, strategy);
  assertAssignee(ctx, verification);
}

/** Only members in good standing can be verified. */
export function assertGoodStanding(subject: MemberRecord): void {
  if (subject.standing !== 'good')
    throw new InvalidStateError('Verification requires a member in good standing.');
}
