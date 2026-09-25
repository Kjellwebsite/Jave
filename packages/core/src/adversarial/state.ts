import type {
  adversarialOutcome,
  adversarialRoles,
  adversarialRoleStatus,
  adversarialTechnique,
  trialStatus,
} from '@jave/database';

/**
 * Adversarial role lifecycle (pure).
 *
 *   planned ──authorize (2nd person)──► planned+authorized ──brief──► briefed
 *   briefed ──activate (trial active)──► active ──conclude──► concluded
 *   concluded ──reveal (trial over, evaluated)──► revealed
 *   planned | briefed | active | concluded ──abort──► aborted
 *   aborted (after it was active) ──reveal──► revealed   // participants were exposed: they get a debrief
 */
export type RoleRecord = typeof adversarialRoles.$inferSelect;
export type RoleStatus = (typeof adversarialRoleStatus.enumValues)[number];
export type Technique = (typeof adversarialTechnique.enumValues)[number];
export type Outcome = (typeof adversarialOutcome.enumValues)[number];
export type TrialStatus = (typeof trialStatus.enumValues)[number];

/** The exercise has not finished: the kill switch and trial end abort these. */
export const LIVE_STATUSES: readonly RoleStatus[] = ['planned', 'briefed', 'active'];

/** States from which staff may abort. */
export const ABORTABLE_STATUSES: readonly RoleStatus[] = [
  'planned',
  'briefed',
  'active',
  'concluded',
];

/** States in which the operative knows about the role and may raise RED FLAG. */
export const OPERATIVE_STOPPABLE_STATUSES: readonly RoleStatus[] = ['briefed', 'active'];

/** States in which staff may add triggers. */
export const TRIGGER_EDITABLE_STATUSES: readonly RoleStatus[] = ['planned', 'briefed', 'active'];

/** Trial states in which a role can still be planned, authorized or briefed. */
export const PLANNING_TRIAL_STATUSES: readonly TrialStatus[] = [
  'draft',
  'recruiting',
  'teams_assigned',
  'active',
];

/** Trial states after which roles may be revealed. */
export const REVEAL_TRIAL_STATUSES: readonly TrialStatus[] = [
  'evaluating',
  'completed',
  'cancelled',
];

type RoleState = Pick<RoleRecord, 'status' | 'activatedAt' | 'revealedAt'>;

/** Participants were exposed to the exercise (it was activated at some point). */
export function wasExposed(role: Pick<RoleRecord, 'activatedAt'>): boolean {
  return role.activatedAt !== null;
}

/** An exercise that ran and has ended, not yet revealed: it can be evaluated and revealed. */
export function isAwaitingReveal(role: RoleState): boolean {
  if (role.revealedAt !== null) return false;
  return role.status === 'concluded' || (role.status === 'aborted' && wasExposed(role));
}

/** Observations can be recorded while the exercise runs and afterwards until the reveal. */
export function acceptsObservations(role: RoleState): boolean {
  return role.status === 'active' || isAwaitingReveal(role);
}

export function isLive(status: RoleStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

export const TECHNIQUE_LABELS: Record<Technique, string> = {
  social_engineering: 'Social engineering',
  instruction_integrity: 'Instruction integrity',
  permission_hygiene: 'Permission hygiene',
  data_handling: 'Data handling',
  verification_discipline: 'Verification discipline',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  resisted: 'Resisted',
  detected: 'Detected',
  reported: 'Reported',
  partial: 'Partial',
  failure: 'Failure',
};
