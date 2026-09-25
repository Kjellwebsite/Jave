import type { ScheduledEventStatus } from './gateway';

/**
 * Discord's scheduled-event state machine, as a pure plan. Discord allows
 * only scheduled → active | canceled and active → completed; completed and
 * canceled are final, and the start of an active event can no longer move.
 * Gateways use this to reach a target state in legal steps.
 */
export interface ScheduledEventPlan {
  /** Name, description, end and location may still change. */
  editable: boolean;
  /** The start may still change (only before the event is active). */
  startEditable: boolean;
  /** Status changes to apply after the field edit, in order. */
  transitions: Exclude<ScheduledEventStatus, 'scheduled'>[];
  /** The target cannot be expressed on Discord (active → canceled): delete the event instead. */
  remove: boolean;
}

const FINAL: ScheduledEventPlan = {
  editable: false,
  startEditable: false,
  transitions: [],
  remove: false,
};

export function planScheduledEventUpdate(
  current: ScheduledEventStatus,
  target: ScheduledEventStatus,
): ScheduledEventPlan {
  if (current === 'completed' || current === 'canceled') return FINAL;
  if (current === 'scheduled') {
    const transitions: ScheduledEventPlan['transitions'] =
      target === 'active'
        ? ['active']
        : target === 'completed'
          ? ['active', 'completed']
          : target === 'canceled'
            ? ['canceled']
            : [];
    return { editable: true, startEditable: true, transitions, remove: false };
  }
  // Active: it cannot return to scheduled; a cancellation removes it.
  if (target === 'canceled') return { ...FINAL, remove: true };
  return {
    editable: true,
    startEditable: false,
    transitions: target === 'completed' ? ['completed'] : [],
    remove: false,
  };
}
