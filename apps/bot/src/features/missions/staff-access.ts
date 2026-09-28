import { can } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { failure } from '../../ui/components';

export const MANAGER_ONLY = 'Only mission staff (canManageMissions) can do this.';

/** The calm refusal shown before a staff form opens; services still enforce every rule. */
export function restricted(description: string): ReplyPayload {
  return { embeds: [failure('ACCESS RESTRICTED', description)], ephemeral: true };
}

/**
 * UI-level gate for staff controls that open a form or a panel: refusing
 * before the modal saves the user from filling in a form that will fail.
 * Returns false after replying when the user lacks canManageMissions.
 */
export async function ensureManager(h: HandlerContext): Promise<boolean> {
  if (can(h.ctx, 'canManageMissions')) return true;
  await h.respond(restricted(MANAGER_ONLY));
  return false;
}
