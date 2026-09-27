import type { applications } from '@jave/core';
import { customId } from '../../interactions/custom-id';

/**
 * Custom ids of the applications feature: `applications:<action>[:args]`.
 * They route only. Every handler calls core as the clicking user, which
 * re-checks identity, capability, ownership and state.
 */
export const APPLICATIONS_NS = 'applications';

/** Applicant self-service actions (the /apply panel). */
export const APPLICANT_ACTIONS = {
  panel: 'panel',
  start: 'start',
  domain: 'domain',
  edit: 'edit',
  submit: 'submit',
  withdraw: 'withdraw',
  withdrawConfirm: 'withdraw_confirm',
  save: 'save',
} as const;

/** Staff actions on review cards and staff views. Card buttons use core's StaffAction names. */
export const STAFF_ACTIONS = {
  details: 'details',
  decide: 'decide',
  reviewSubmit: 'review_submit',
  interviewSubmit: 'interview_submit',
  decideSubmit: 'decide_submit',
  queue: 'queue',
  pick: 'pick',
} as const;

export type ModalPage = 1 | 2;
export const MODAL_PAGES: readonly ModalPage[] = [1, 2];

export type Decision = 'accept' | 'reject';
export const DECISIONS: readonly Decision[] = ['accept', 'reject'];

export function applicationsId(action: string, ...args: (string | number)[]): string {
  return customId(APPLICATIONS_NS, action, ...args);
}

/** A card button: `applications:<StaffAction>:<applicationId>` (the Discord job contract). */
export function cardActionId(action: applications.StaffAction, applicationId: string): string {
  return applicationsId(action, applicationId);
}

export function parseModalPage(value: string | undefined): ModalPage | null {
  return MODAL_PAGES.find((page) => String(page) === value) ?? null;
}

export function parseDecision(value: string | undefined): Decision | null {
  return DECISIONS.find((decision) => decision === value) ?? null;
}
