import type { VerificationOutcome, verifications } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import type { MemberRecord } from '../identity/users.service';
import type { Capability } from '../permissions/capabilities';
import type { VerificationTarget } from './schemas';

export type VerificationRecord = typeof verifications.$inferSelect;
export type VerificationType = VerificationRecord['type'];
export type VerificationStatus = VerificationRecord['status'];
export type { VerificationOutcome };

/** A verification row plus its subject's user id (needed for two-person checks and notices). */
export interface LoadedVerification extends VerificationRecord {
  subjectUserId: string;
}

/** A validated, normalized target produced by a strategy at request time. */
export interface ResolvedTarget {
  targetType: string;
  targetId: string | null;
  /** One open verification per key (see verifications_open_target_uq). */
  targetKey: string;
  targetLabel: string;
  facetKey: string | null;
  requestedRank: string | null;
  /** Used when the requester gives no claim text. */
  defaultClaim: string;
}

export interface ApprovalInput {
  /** Skill only: the rank the verifier grants (defaults to the requested rank). */
  grantedRank: string | null;
  note: string;
  /** Human reference, e.g. VER-0042. */
  reference: string;
  /** Stamp for every row the approval touches, so revocation can match them exactly. */
  decidedAt: Date;
}

export interface ApprovalResult {
  outcome: VerificationOutcome;
  grantedRank: string | null;
  /** True when a called service already notified the subject by DM (e.g. rank.updated). */
  subjectNotified: boolean;
}

export interface RevocationInput {
  reason: string;
  reference: string;
}

export interface RevocationResult {
  /** Whether approval side effects were actually reversed. */
  reverted: boolean;
  /** Short machine-readable explanation, recorded in the audit log. */
  detail: string;
  subjectNotified: boolean;
}

/**
 * Per-type verification behaviour. Strategies validate targets (at request
 * time and again at decision time) and own every side effect of approval and
 * revocation. They run inside the caller's transaction and never authorize:
 * the decision service has already done that.
 */
export interface VerificationStrategy {
  type: VerificationType;
  /** Capabilities the decider needs in addition to canVerifyMembers. */
  deciderCapabilities: readonly Capability[];
  /** When true, an approved verification of the same target blocks new requests. */
  singleApproval: boolean;
  resolveTarget: (
    ctx: ServiceContext,
    subject: MemberRecord,
    target: VerificationTarget,
  ) => Promise<ResolvedTarget>;
  approve: (
    tx: ServiceContext,
    verification: LoadedVerification,
    input: ApprovalInput,
  ) => Promise<ApprovalResult>;
  revoke: (
    tx: ServiceContext,
    verification: LoadedVerification,
    outcome: VerificationOutcome,
    input: RevocationInput,
  ) => Promise<RevocationResult>;
}
