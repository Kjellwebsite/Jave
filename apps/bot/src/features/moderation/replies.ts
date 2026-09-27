import { can, moderation } from '@jave/core';
import type { HandlerContext } from '../../interactions/types';
import { failure } from '../../ui/components';
import type { CaseActionKey } from './pending';

/** A stale, forged or foreign control: calm refusal, nothing else happens. */
export async function expired(
  h: HandlerContext,
  detail = 'This control is no longer active.',
): Promise<void> {
  await h.respond({ embeds: [failure('EXPIRED', detail)], ephemeral: true });
}

export async function restricted(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('ACCESS RESTRICTED', 'Your role does not include this capability.')],
    ephemeral: true,
  });
}

/**
 * UI gate before a form or a confirmation step is shown: a moderator without
 * the action's capability is refused up front instead of after filling in a
 * reason. The case services still authorize (capability and hierarchy) when
 * the action runs. Returns true when the caller may continue.
 */
export async function mayStart(h: HandlerContext, action: CaseActionKey): Promise<boolean> {
  if (can(h.ctx, moderation.CASE_CAPABILITY[action])) return true;
  await restricted(h);
  return false;
}
