import type { APISelectMenuOption } from 'discord.js';
import { adversarial } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import { button, row, stringSelect } from '../../ui/components';
import { clip } from '../../ui/format';

export const ADVERSARIAL_NS = 'adversarial';

/**
 * Operative controls. RED FLAG is a single press, never behind a
 * confirmation: the stop protocol says the exercise ends immediately.
 */
export const OPERATIVE_ACTIONS = {
  redFlag: 'redflag',
  fireTrigger: 'fire',
} as const;

/** Discord caps select option labels at 100 characters. */
export const TRIGGER_LABEL_MAX = 100;

/**
 * The controls under an operative's briefing — in `/trial briefing` and in the
 * briefing DM alike: RED FLAG always (while briefed or active), and the
 * trigger select while the exercise is active. The custom ids only route:
 * core decides who may press them.
 */
export function operativeControls(
  briefing: adversarial.BriefingView,
): MessagePayload['components'] {
  if (briefing.status !== 'briefed' && briefing.status !== 'active') return undefined;
  const rows: NonNullable<MessagePayload['components']> = [];
  const open = briefing.exerciseActive ? briefing.triggers.filter((t) => !t.firedAt) : [];
  if (open.length > 0) {
    const options: APISelectMenuOption[] = open.map((trigger) => ({
      // Select labels are plain text: no markdown to escape, mentions never render.
      label: clip(trigger.label, TRIGGER_LABEL_MAX),
      value: trigger.id,
      description: 'Mark as carried out',
    }));
    rows.push(
      row(
        stringSelect(
          customId(ADVERSARIAL_NS, OPERATIVE_ACTIONS.fireTrigger, briefing.roleId),
          'Mark a trigger as carried out',
          options,
        ),
      ),
    );
  }
  rows.push(
    row(
      button(
        `${adversarial.STOP_WORD} — stop now`,
        customId(ADVERSARIAL_NS, OPERATIVE_ACTIONS.redFlag, briefing.roleId),
        'danger',
      ),
    ),
  );
  return rows;
}
