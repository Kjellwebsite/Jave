import type { HandlerContext, ReplyPayload } from '../../interactions/types';

/**
 * Replace the message a press (or a modal opened from it) came from when
 * only the presser can see it (their own list, detail, settings, assign or
 * review panel); otherwise answer with a new private message. A public card
 * is never rewritten by anyone's press, whatever custom id it carries.
 */
export async function presentInPlace(h: HandlerContext, payload: ReplyPayload): Promise<void> {
  if (h.interaction.sourceMessage?.ephemeral === true) await h.interaction.update(payload);
  else await h.respond({ ...payload, ephemeral: true });
}
