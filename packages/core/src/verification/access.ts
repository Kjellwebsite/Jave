import type { ServiceContext } from '../kernel/context';
import { actorUserId } from '../permissions/actor';
import { can, isSelf } from '../permissions/authorize';
import type { VerificationDetail } from './query.service';
import { isOpen, isPastExpiry } from './rules';
import { strategyFor } from './strategies';

/**
 * Which verifier controls a viewer can use on one verification right now.
 * Pure (no I/O, no audit): surfaces use it to show only the controls that
 * can succeed. The services remain the authority and re-check everything,
 * auditing refusals, when a control is used.
 */

export type VerificationControl = 'start_review' | 'approve' | 'reject' | 'revoke';

/** Why a verifier sees no decision controls. */
export type VerificationBlock =
  'subject' | 'requester' | 'assigned_elsewhere' | 'capability' | 'closed';

export interface VerificationAccess {
  controls: VerificationControl[];
  /** Set when the viewer holds canVerifyMembers but cannot act; null otherwise. */
  blocked: VerificationBlock | null;
}

/** User-safe explanations, worded like the services' own refusals. */
export const VERIFICATION_BLOCK_MESSAGES: Readonly<Record<VerificationBlock, string>> = {
  subject: 'You cannot verify your own request. Another verifier must decide it.',
  requester: 'You opened this request for someone else. A second verifier must decide it.',
  assigned_elsewhere: 'This verification is assigned to another verifier. Reassign it first.',
  capability: 'Deciding this type needs a capability your roles do not include.',
  closed: 'This verification is closed. Nothing can be decided on it now.',
};

const NONE: VerificationAccess = { controls: [], blocked: null };

export function verificationAccess(
  ctx: Pick<ServiceContext, 'actor' | 'clock'>,
  detail: VerificationDetail,
): VerificationAccess {
  if (!can(ctx, 'canVerifyMembers')) return NONE;
  if (isSelf(ctx.actor, detail.subject.memberId)) return { controls: [], blocked: 'subject' };
  const capable = strategyFor(detail.type).deciderCapabilities.every((capability) =>
    can(ctx, capability),
  );
  if (!capable) return { controls: [], blocked: 'capability' };
  if (detail.status === 'approved') return { controls: ['revoke'], blocked: null };
  if (!isOpen(detail.status) || isPastExpiry(detail.expiresAt, ctx.clock.now()))
    return { controls: [], blocked: 'closed' };

  const me = actorUserId(ctx.actor);
  if (detail.openedBy === 'staff' && me !== null && detail.staff?.requestedBy?.userId === me)
    return { controls: [], blocked: 'requester' };
  if (detail.assignedVerifier && detail.assignedVerifier.userId !== me)
    return { controls: [], blocked: 'assigned_elsewhere' };
  return {
    controls:
      detail.status === 'pending' ? ['start_review', 'approve', 'reject'] : ['approve', 'reject'],
    blocked: null,
  };
}
