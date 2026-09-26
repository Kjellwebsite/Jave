import type { APIEmbed } from 'discord.js';
import { adversarial } from '@jave/core';
import type { MessagePayload } from '../../discord/gateway';
import { field, panel } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { packEmbeds, safeChunks, splitText } from '../trials/render/text';

type BriefingView = adversarial.BriefingView;
type DebriefView = adversarial.DebriefView;
type RoleStatus = adversarial.RoleStatus;

/** Every operative-facing surface says so: nothing here is real. */
export const SANDBOX_MARK = 'SANDBOX EXERCISE · FICTIONAL DATA ONLY';
const NAME_MAX = 120;

const STATUS_TEXT: Record<RoleStatus, string> = {
  planned: 'PLANNED.',
  briefed: 'BRIEFED — stand by until staff marks the exercise ACTIVE.',
  active: 'ACTIVE — proceed per your objective, and nothing beyond it.',
  concluded: 'CONCLUDED — stand down.',
  aborted: 'STOPPED — stand down immediately.',
  revealed: 'REVEALED — the exercise is over.',
};

function section(
  kicker: string,
  title: string,
  text: string,
  color: number = COLORS.base,
): APIEmbed[] {
  const chunks = safeChunks(text);
  return chunks.map((chunk, index) =>
    panel({
      kicker: chunks.length > 1 ? `${kicker} ${index + 1}/${chunks.length}` : kicker,
      title: index === 0 ? title : `${title} (continued)`,
      description: chunk,
      color,
    }),
  );
}

function triggerLines(view: BriefingView): string {
  if (view.triggers.length === 0) return 'None scheduled. Staff will tell you when to act.';
  return view.triggers
    .map((trigger) => {
      const when = trigger.plannedFor ? ` ${GLYPH.dot} planned ${discordTime(trigger.plannedFor, 'f')}` : '';
      const fired = trigger.firedAt ? ` ${GLYPH.dot} FIRED` : '';
      return `${GLYPH.bullet} **${userText(trigger.label, NAME_MAX)}**${when}${fired}\n${userText(trigger.description, 1000)}`;
    })
    .join('\n');
}

/**
 * The operative's confidential briefing, section by section. Nothing is
 * clipped: long sections continue in further embeds. The guardrails, the
 * operating rules and the stop-word protocol are always present.
 */
export function briefingEmbeds(view: BriefingView): APIEmbed[] {
  const team = view.team ? ` — ${userText(view.team.name, NAME_MAX)}` : '';
  const header = panel({
    kicker: `CONFIDENTIAL ${GLYPH.dot} ${SANDBOX_MARK}`,
    title: `Briefing — Trial #${view.trial.number}${team}`,
    description: [
      `Revision ${view.revision}. ${STATUS_TEXT[view.status]}`,
      'Keep this briefing to yourself until the official reveal.',
    ].join('\n'),
    color: COLORS.chrome,
    fields: [
      field(
        'Scenario',
        `${userText(view.scenario.title, NAME_MAX)} ${GLYPH.dot} ${view.techniqueLabel}`,
      ),
    ],
  });
  const triggerChunks = splitText(triggerLines(view));
  return [
    header,
    ...section('OBJECTIVE', 'Objective', view.objective),
    ...section('SANDBOX ASSETS', 'Sandbox assets', view.sandboxAssets),
    ...triggerChunks.map((chunk, index) =>
      panel({
        kicker: triggerChunks.length > 1 ? `TRIGGERS ${index + 1}/${triggerChunks.length}` : 'TRIGGERS',
        title: index === 0 ? 'Planned beats' : 'Planned beats (continued)',
        description: chunk,
        color: COLORS.base,
      }),
    ),
    ...section('GUARDRAILS', 'Guardrails', view.guardrails, COLORS.warning),
    panel({
      kicker: 'OPERATING RULES',
      title: 'Operating rules',
      description: view.operatingRules.map((rule) => `${GLYPH.bullet} ${rule}`).join('\n'),
      color: COLORS.warning,
    }),
    panel({
      kicker: 'STOP PROTOCOL',
      title: `Stop word — ${view.stopWord}`,
      description: view.stopProtocol,
      color: COLORS.danger,
    }),
  ];
}

/** The briefing as DM messages, in order. */
export function briefingMessages(view: BriefingView): MessagePayload[] {
  return packEmbeds(briefingEmbeds(view)).map((embeds) => ({ embeds }));
}

/** The STOP notice: fixed title and body, never the abort reason. */
export function stopMessage(notice: { title: string; body: string }): MessagePayload {
  return {
    embeds: [
      panel({ kicker: SANDBOX_MARK, title: notice.title, description: notice.body, color: COLORS.danger }),
    ],
  };
}

/**
 * The team debrief after the reveal: aggregated outcomes, never individual
 * participants' names (the operative is named — the reveal is the point).
 */
export function debriefMessages(view: DebriefView): MessagePayload[] {
  const team = view.team ? ` — ${userText(view.team.name, NAME_MAX)}` : '';
  const header = panel({
    kicker: SANDBOX_MARK,
    title: `${view.title}${team}`,
    description: view.disclosure,
    color: COLORS.chrome,
    fields: [
      field(
        'Scenario',
        `${userText(view.scenario.title, NAME_MAX)} ${GLYPH.dot} ${view.techniqueLabel}`,
      ),
      field('Operative', userText(view.operative.displayName, NAME_MAX), true),
      field('Security culture', `${view.securityCultureScore}/10`, true),
      field('Observed', adversarial.formatOutcomeCounts(view.outcomes)),
      ...(view.stoppedEarly ? [field('Note', 'The exercise was stopped early.')] : []),
    ],
  });
  return packEmbeds([header, ...section('DEBRIEF', 'What we learned', view.debrief)]).map(
    (embeds) => ({ embeds }),
  );
}
