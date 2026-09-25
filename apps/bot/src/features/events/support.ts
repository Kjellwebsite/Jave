import { can, isUuid, type ServiceContext, ValidationError } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { failure } from '../../ui/components';
import { MANAGE_EVENTS } from './constants';

/** An event or match id from a picker, option or custom id; anything else is refused. */
export function requireId(value: string | null | undefined, what = 'an event'): string {
  if (!value || !isUuid(value)) throw new ValidationError(`Choose ${what} from the list.`);
  return value;
}

/** Whether to show staff controls. Core authorizes every action regardless. */
export function isEventStaff(ctx: ServiceContext): boolean {
  return can(ctx, MANAGE_EVENTS);
}

/** Dashboard link for an event (null without a configured public URL). */
export function dashboardEventUrl(
  ctx: ServiceContext,
  eventId: string,
  tab?: string,
): string | null {
  const base = ctx.config.publicUrl;
  if (!base) return null;
  try {
    const url = new URL(`/events/${eventId}`, base);
    if (tab) url.searchParams.set('tab', tab);
    return url.toString();
  } catch {
    return null;
  }
}

/** The reply for a control that no longer routes (forged, stale or malformed custom id). */
export async function respondExpired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

/** Replies to a staff-only command for members without the capability, before any modal opens. */
export async function respondStaffOnly(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('ACCESS RESTRICTED', `Requires ${MANAGE_EVENTS}.`)],
    ephemeral: true,
  });
}
