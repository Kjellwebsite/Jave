import { DAY } from '../kernel/clock';
import { verificationReference } from './rules';
import type { VerificationStatus, VerificationType } from './types';

/** User-facing copy. Calm, precise, uppercase kickers — no emoji. */

export const TYPE_LABELS: Readonly<Record<VerificationType, string>> = {
  identity: 'IDENTITY',
  skill: 'SKILL',
  project: 'PROJECT',
  contribution: 'CONTRIBUTION',
  achievement: 'ACHIEVEMENT',
  trial: 'TRIAL',
};

export const STATUS_LABELS: Readonly<Record<VerificationStatus, string>> = {
  pending: 'PENDING',
  in_review: 'IN REVIEW',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  revoked: 'REVOKED',
  expired: 'EXPIRED',
};

interface CopySubject {
  number: number;
  type: VerificationType;
  targetLabel: string;
}

/** "VER-0042 — SKILL: Technical" */
export function verificationHeadline(v: CopySubject): string {
  return `${verificationReference(v.number)} — ${TYPE_LABELS[v.type]}: ${v.targetLabel}`;
}

export interface NoticeCopy {
  title: string;
  body: string;
}

export type SubjectNotice =
  | { kind: 'approved'; grantedRank: string | null }
  | { kind: 'rejected'; note: string }
  | { kind: 'revoked'; reason: string }
  | { kind: 'expired'; requestedAt: Date; expiresAt: Date };

export function subjectNoticeCopy(v: CopySubject, notice: SubjectNotice): NoticeCopy {
  const headline = verificationHeadline(v);
  switch (notice.kind) {
    case 'approved':
      return {
        title: 'VERIFICATION APPROVED',
        body: notice.grantedRank
          ? `${headline}. Verified at ${notice.grantedRank}.`
          : `${headline}. Verified.`,
      };
    case 'rejected':
      return {
        title: 'VERIFICATION REJECTED',
        body: `${headline}. Not verified. Note: ${notice.note}`,
      };
    case 'revoked':
      return {
        title: 'VERIFICATION REVOKED',
        body: `${headline}. Verification withdrawn. Reason: ${notice.reason}`,
      };
    case 'expired': {
      const days = Math.max(
        1,
        Math.round((notice.expiresAt.getTime() - notice.requestedAt.getTime()) / DAY),
      );
      return {
        title: 'VERIFICATION EXPIRED',
        body: `${headline}. No decision within ${days} days. Request again when ready.`,
      };
    }
  }
}

export function assignedNoticeCopy(v: CopySubject): NoticeCopy {
  return {
    title: 'VERIFICATION ASSIGNED',
    body: `${verificationHeadline(v)}. Assigned to you for review.`,
  };
}
