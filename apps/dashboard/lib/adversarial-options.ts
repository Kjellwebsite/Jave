import type { adversarial } from '@jave/core';

interface Subject {
  memberId: string;
  displayName: string;
}

/**
 * Triggers an observation can be tied to: approved ones only. Pending
 * triggers never reached the operative; the adversarial service refuses them.
 */
export function observationTriggers(
  triggers: readonly Pick<adversarial.TriggerRecord, 'id' | 'label' | 'approvedAt'>[],
): { value: string; label: string }[] {
  return triggers
    .filter((trigger) => trigger.approvedAt !== null)
    .map((trigger) => ({ value: trigger.id, label: trigger.label }));
}

/**
 * Who an observation can name: the team's participants, never the operative
 * (the exercise observes the team's response to them). The service checks
 * again that the subject is a selected participant on the targeted team.
 */
export function observationSubjects(
  members: readonly Subject[],
  operativeMemberId: string,
): Subject[] {
  return members.filter((member) => member.memberId !== operativeMemberId);
}
