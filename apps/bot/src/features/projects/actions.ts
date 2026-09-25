import type { APIEmbed } from 'discord.js';
import type {
  ComponentHandler,
  HandlerContext,
  ModalHandler,
  ReplyPayload,
} from '../../interactions/types';
import { failure } from '../../ui/components';

/** A component or modal handler for one custom-id action; args follow the action. */
export type Action = (h: HandlerContext, args: readonly string[]) => Promise<void>;
export type ActionMap = Readonly<Record<string, Action>>;

/**
 * Replace the message a component sits on with a result. Components are
 * always sent (possibly empty) so stale controls never survive the edit.
 */
export function replaceWith(
  h: HandlerContext,
  embeds: APIEmbed[],
  components: ReplyPayload['components'] = [],
): Promise<void> {
  return h.interaction.update({ embeds, components });
}

/** The first selected value of a select menu ('' when none). */
export function selectedValue(h: HandlerContext): string {
  return h.interaction.values[0] ?? '';
}

/** Merge action maps; two handlers for one action is a bug. */
export function mergeActions(namespace: string, ...maps: ActionMap[]): ActionMap {
  const merged: Record<string, Action> = {};
  for (const map of maps) {
    for (const [action, handler] of Object.entries(map)) {
      if (merged[action]) throw new Error(`duplicate ${namespace} action ${action}`);
      merged[action] = handler;
    }
  }
  return merged;
}

/**
 * One component/modal handler for a namespace, dispatching on the custom-id
 * action. Unknown actions (retired or forged) answer EXPIRED; own-property
 * lookup keeps "__proto__"-style actions from reaching Object.prototype.
 */
export function actionDispatcher(
  namespace: string,
  actions: ActionMap,
): ComponentHandler & ModalHandler {
  return {
    namespace,
    async handle(h, action, args) {
      const run = Object.hasOwn(actions, action) ? actions[action] : undefined;
      if (!run) {
        await h.respond({
          embeds: [failure('EXPIRED', 'This control is no longer active.')],
          ephemeral: true,
        });
        return;
      }
      await run(h, args);
    },
  };
}
