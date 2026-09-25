import type { referralStatus } from '@jave/database';

/**
 * Referral state machine (INVITED is the invite-use count, not a row state):
 *
 *   JOINED ──retention──▶ RETAINED ──onboarding + clean score──▶ VALID
 *     │                      │                                   │
 *     └──leave──▶ LEFT ◀─────┘                                   │
 *     └──self-invite / staff──▶ INVALID ◀──────staff─────────────┘
 *
 * LEFT and INVALID are terminal. A VALID referral stays VALID when the member
 * later leaves (leftAt is recorded): validity is an earned, historical fact.
 */
export type ReferralStatus = (typeof referralStatus.enumValues)[number];

export const LIVE_REFERRAL_STATUSES = [
  'joined',
  'retained',
] as const satisfies readonly ReferralStatus[];

export const REFERRAL_TRANSITIONS: Readonly<Record<ReferralStatus, readonly ReferralStatus[]>> = {
  joined: ['retained', 'left', 'invalid'],
  retained: ['valid', 'left', 'invalid'],
  valid: ['invalid'],
  left: [],
  invalid: [],
};

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  return REFERRAL_TRANSITIONS[from].includes(to);
}

export function isLiveReferral(status: ReferralStatus): boolean {
  return (LIVE_REFERRAL_STATUSES as readonly ReferralStatus[]).includes(status);
}
