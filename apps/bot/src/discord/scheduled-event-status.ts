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
  /** The target cannot be expressed on Discord without a false step: delete the event instead. */
  remove: boolean;
}

/**
 * Discord refuses a scheduled start that is not in the future (Invalid Form
 * Body, "Cannot schedule event in the past"). A start sent to Discord keeps
 * at least this much lead over the bot's clock, absorbing clock skew and
 * request latency.
 */
export const SCHEDULED_START_LEAD_MS = 60_000;

const FINAL: ScheduledEventPlan = {
  editable: false,
  startEditable: false,
  transitions: [],
  remove: false,
};

const REMOVE: ScheduledEventPlan = { ...FINAL, remove: true };

export function planScheduledEventUpdate(
  current: ScheduledEventStatus,
  target: ScheduledEventStatus,
): ScheduledEventPlan {
  if (current === 'completed' || current === 'canceled') return FINAL;
  if (current === 'scheduled') {
    // Completing needs a start first, and starting notifies everyone marked Interested:
    // an event that never went live on Discord is removed instead.
    if (target === 'completed') return REMOVE;
    const transitions: ScheduledEventPlan['transitions'] =
      target === 'active' ? ['active'] : target === 'canceled' ? ['canceled'] : [];
    return { editable: true, startEditable: true, transitions, remove: false };
  }
  // Active: it cannot return to scheduled; a cancellation removes it.
  if (target === 'canceled') return REMOVE;
  // A completed event leaves Discord's list: only the status changes, no fields to refuse.
  if (target === 'completed') return { ...FINAL, transitions: ['completed'] };
  return { editable: true, startEditable: false, transitions: [], remove: false };
}

/** The earliest start Discord accepts right now. */
export function earliestScheduledStart(now: Date): Date {
  return new Date(now.getTime() + SCHEDULED_START_LEAD_MS);
}

/**
 * The start to send with a field edit, or undefined to leave Discord's as is:
 * only a start that may still move, differs from Discord's current one and
 * lies far enough ahead. Re-sending an unchanged start (Discord validates it
 * whenever present) would refuse the whole edit once the start has passed.
 */
export function scheduledStartEdit(
  plan: Pick<ScheduledEventPlan, 'startEditable'>,
  current: Date | null,
  requested: Date | undefined,
  now: Date,
): Date | undefined {
  if (!plan.startEditable || !requested) return undefined;
  if (current && current.getTime() === requested.getTime()) return undefined;
  if (requested.getTime() < earliestScheduledStart(now).getTime()) return undefined;
  return requested;
}
