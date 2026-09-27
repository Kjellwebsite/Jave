import type { verification } from '@jave/core';
import { COLORS } from '../../ui/theme';
import type { VerificationType } from './ids';

/** What each type proves, for the request select. ≤ 100 characters each. */
export const TYPE_DESCRIPTIONS: Readonly<Record<VerificationType, string>> = {
  skill: 'A capability at a rank. Moves a CLAIMED rank to VERIFIED.',
  project: 'Your active membership and role in a project.',
  contribution: 'A contribution you recorded, still awaiting verification.',
  achievement: 'An achievement you hold, still unverified.',
  trial: 'A published trial result of yours.',
  identity: 'That you are who you say you are. Grants the VERIFIED role.',
};

/** Shown when a member has nothing of a type that could be verified right now. */
export const NO_TARGET_COPY: Readonly<Record<Exclude<VerificationType, 'identity'>, string>> = {
  skill: 'Every capability is already verified at the top rank, or has an open request.',
  project: 'You have no active project membership without an open or approved verification.',
  contribution: 'You have no submitted contribution awaiting verification.',
  achievement: 'You have no unverified achievement without an open request.',
  trial: 'You have no published trial result without an open or approved verification.',
};

export const STATUS_COLORS: Readonly<Record<verification.VerificationStatus, number>> = {
  pending: COLORS.info,
  in_review: COLORS.warning,
  approved: COLORS.success,
  rejected: COLORS.danger,
  revoked: COLORS.danger,
  expired: COLORS.steel,
};

export const OPENED_BY_LABELS: Readonly<Record<verification.OpenedBy, string>> = {
  subject: 'The member',
  staff: 'Staff, on their behalf',
  system: 'JAVE',
};
