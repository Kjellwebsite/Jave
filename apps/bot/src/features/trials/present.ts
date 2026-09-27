import type { HandlerContext, ReplyPayload } from '../../interactions/types';

/** The press came from a message only the presser can see (an ephemeral reply). */
export function fromPrivateMessage(h: HandlerContext): boolean {
  return h.interaction.sourceMessage?.ephemeral === true;
}

/**
 * Replace the message the press came from when only the presser can see it —
 * a staff control panel, a member's own trial view — instead of stacking a
 * copy; otherwise answer with a new private message. A public card or a
 * team-channel post is never edited by anyone's press.
 */
export async function presentInPlace(h: HandlerContext, payload: ReplyPayload): Promise<void> {
  if (fromPrivateMessage(h)) await h.interaction.update(payload);
  else await h.respond(payload);
}
