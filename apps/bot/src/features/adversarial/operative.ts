import { adversarial, isUuid, NotFoundError } from '@jave/core';
import type { ComponentHandler, HandlerContext, ReplyPayload } from '../../interactions/types';
import { panel } from '../../ui/components';
import { userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { ADVERSARIAL_NS, OPERATIVE_ACTIONS } from './controls';
import { briefingMessages, SANDBOX_MARK } from './render';

const TRIGGER_LABEL_MAX = 100;
const RED_FLAG_NOTE = 'Raised by the operative from Discord.';

/**
 * The single answer for "no briefing": identical for a member who never had
 * a role, an operative whose role is still planned, a quarantined operative
 * and a forged control — nothing distinguishes them.
 */
export function noBriefingReply(): ReplyPayload {
  return {
    embeds: [
      panel({
        kicker: 'TRIAL BRIEFING',
        title: 'No briefing',
        description: 'No confidential briefing is addressed to you.',
        color: COLORS.steel,
      }),
    ],
    ephemeral: true,
  };
}

/** Messages for one briefing: every section, controls under the last message. */
function briefingReplies(entry: adversarial.MyBriefing): ReplyPayload[] {
  return briefingMessages(entry.briefing).map((message) => ({ ...message, ephemeral: true }));
}

/** /trial briefing — the caller's own confidential briefings, privately. */
export async function showMyBriefings(h: HandlerContext): Promise<void> {
  const briefings = await adversarial.listMyBriefings(h.ctx);
  if (briefings.length === 0) {
    await h.respond(noBriefingReply());
    return;
  }
  const replies = briefings.flatMap(briefingReplies);
  await h.respond(replies[0]!);
  for (const reply of replies.slice(1)) await h.interaction.followUp(reply);
}

/**
 * Operative controls (RED FLAG, trigger fired). Core decides who may act;
 * anyone else — a forged id, a teammate, a stale control — gets exactly the
 * "no briefing" answer, whether or not the role exists.
 */
export const adversarialComponents: ComponentHandler = {
  namespace: ADVERSARIAL_NS,
  async handle(h, action, args) {
    const roleId = args[0] ?? '';
    if (!isUuid(roleId)) return h.respond(noBriefingReply());
    try {
      switch (action) {
        case OPERATIVE_ACTIONS.redFlag: {
          const result = await adversarial.raiseRedFlag(h.ctx, { roleId, note: RED_FLAG_NOTE });
          return await h.respond({
            embeds: [
              panel({
                kicker: SANDBOX_MARK,
                title: `${adversarial.STOP_WORD} — exercise stopped`,
                description: result.alreadyStopped
                  ? 'The exercise was already stopped. Stand down and send nothing further.'
                  : 'Stand down now. Send nothing further. Staff will follow up.',
                color: COLORS.danger,
              }),
            ],
            ephemeral: true,
          });
        }
        case OPERATIVE_ACTIONS.fireTrigger: {
          const triggerId = h.interaction.values[0] ?? '';
          if (!isUuid(triggerId)) return await h.respond(noBriefingReply());
          const trigger = await adversarial.fireTrigger(h.ctx, { roleId, triggerId });
          return await h.respond({
            embeds: [
              panel({
                kicker: SANDBOX_MARK,
                title: 'Trigger recorded',
                description: `${GLYPH.verified} ${userText(trigger.label, TRIGGER_LABEL_MAX)} — marked as carried out.`,
                color: COLORS.success,
              }),
            ],
            ephemeral: true,
          });
        }
        default:
          return await h.respond(noBriefingReply());
      }
    } catch (error) {
      if (error instanceof NotFoundError) return h.respond(noBriefingReply());
      throw error;
    }
  },
};
