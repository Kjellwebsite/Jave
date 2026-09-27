import { isUuid, ValidationError, type verification } from '@jave/core';
import { customId } from '../../interactions/custom-id';

/**
 * Custom ids of the verification feature: `verification:<action>[:args]`.
 * They route only; every handler calls core as the clicking user.
 */
export const VERIFICATION_NS = 'verification';

export const ACTIONS = {
  // Member request flow
  start: 'start',
  type: 'type',
  target: 'target',
  rank: 'rank',
  submit: 'submit',
  mine: 'mine',
  status: 'status',
  // Staff queue
  page: 'page',
  pick: 'pick',
  open: 'open',
  claim: 'claim',
  approve: 'approve',
  reject: 'reject',
  revoke: 'revoke',
  decide: 'decide',
  revokeSubmit: 'revoke_submit',
} as const;

export type VerificationType = verification.VerificationType;
export type Decision = 'approve' | 'reject';
const DECISIONS: readonly Decision[] = ['approve', 'reject'];

/** Every type, in the order the request select offers them. */
export const VERIFICATION_TYPES: readonly VerificationType[] = [
  'skill',
  'project',
  'contribution',
  'achievement',
  'trial',
  'identity',
];

const FACET_KEY = /^[a-z0-9_.-]{1,48}$/;
const RANK_CODE = /^[A-Za-z0-9+]{1,4}$/;

export function verificationId(action: string, ...args: (string | number)[]): string {
  return customId(VERIFICATION_NS, action, ...args);
}

export function parseType(value: string | null | undefined): VerificationType | null {
  return VERIFICATION_TYPES.find((type) => type === value) ?? null;
}

export function parseDecision(value: string | undefined): Decision | null {
  return DECISIONS.find((decision) => decision === value) ?? null;
}

/** A request target as it travels in custom ids: validated before it is embedded in one. */
export type TargetRef =
  | { type: 'identity' }
  | { type: 'skill'; facetKey: string; rank: string | null }
  | { type: Exclude<VerificationType, 'identity' | 'skill'>; id: string };

export function parseTargetRef(
  type: VerificationType,
  target: string | null | undefined,
  rank: string | null | undefined,
): TargetRef | null {
  if (type === 'identity') return { type };
  if (!target) return null;
  if (type === 'skill') {
    if (!FACET_KEY.test(target)) throw new ValidationError('Unknown capability.');
    if (rank && !RANK_CODE.test(rank)) throw new ValidationError('Unknown rank.');
    return { type, facetKey: target, rank: rank ? rank.toUpperCase() : null };
  }
  if (!isUuid(target)) throw new ValidationError('Choose a target from the list.');
  return { type, id: target };
}

/** Custom id args of a complete target. */
export function targetArgs(ref: TargetRef): string[] {
  if (ref.type === 'identity') return [ref.type];
  if (ref.type === 'skill') return [ref.type, ref.facetKey, ref.rank ?? ''];
  return [ref.type, ref.id];
}

/** The core request target for a complete ref (skill needs a rank). */
export function toRequestTarget(ref: TargetRef): verification.VerificationTarget {
  switch (ref.type) {
    case 'identity':
      return { type: 'identity' };
    case 'skill':
      if (!ref.rank) throw new ValidationError('Choose a rank.');
      return { type: 'skill', facetKey: ref.facetKey, requestedRank: ref.rank };
    case 'project':
      return { type: 'project', projectId: ref.id };
    case 'contribution':
      return { type: 'contribution', contributionId: ref.id };
    case 'achievement':
      return { type: 'achievement', memberAchievementId: ref.id };
    case 'trial':
      return { type: 'trial', trialResultId: ref.id };
  }
}
